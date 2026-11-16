import type { Proposal, RunState } from "../../../../lib/shared/types";
import type { ResumeDoc } from "./resume-doc";
import { latexProblem, editWarnings, droppedItems } from "./checks";
import { stripIdLabel } from "./prompt";
import { extractMetrics } from "../validators/invariant-checks";

export interface ProposalContext {
  doc: ResumeDoc;
  labels: Record<string, string>;
  state: RunState;
  corpusYaml: string;
}

// Guardrail for chat output: every proposal Claude makes passes through here
// before the user sees it. Hard-rejects what can't apply (unknown target,
// unasked question, non-option, broken LaTeX, no-op); everything else gets
// warn-only notes, same judgment-led rules as tailoring.
export function validateProposals(
  raw: unknown,
  ctx: ProposalContext,
): { proposals: Proposal[]; dropped: string[] } {
  const proposals: Proposal[] = [];
  const dropped: string[] = [];
  if (!Array.isArray(raw)) return { proposals, dropped };

  const { doc, labels, state } = ctx;
  const parts = new Map(doc.parts.map((p) => [p.id, p]));
  const groundMetrics = new Set(
    extractMetrics(`${ctx.corpusYaml}\n${doc.parts.map((p) => p.text).join("\n")}`),
  );

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const { target, after: rawAfter, why } = item as Record<string, unknown>;
    if (typeof target !== "string" || typeof rawAfter !== "string") continue;
    const drop = (reason: string) => dropped.push(`${target}: ${reason}`);
    const warnings: string[] = [];
    let label: string;
    let before: string;
    let after = rawAfter;

    const part = parts.get(target);
    if (part) {
      label = labels[target] ?? target;
      before = state.edits[target] ?? part.text;
      after = stripIdLabel(target, after);
    } else if (target === "cover-letter") {
      label = "Cover letter";
      before = state.coverLetter;
    } else if (target.startsWith("answer:")) {
      const id = target.slice("answer:".length);
      const q = state.questions.find((x) => x.fieldId === id);
      if (!q) {
        drop("not a question on this form");
        continue;
      }
      if (q.options?.length) {
        const opt = q.options.find((o) => o.trim().toLowerCase() === after.trim().toLowerCase());
        if (!opt) {
          drop("not one of the options");
          continue;
        }
        after = opt;
      }
      label = q.label;
      before = state.answers[id] ?? "";
    } else {
      drop("unknown target");
      continue;
    }

    if (after.trim() === before.trim()) {
      drop("no change");
      continue;
    }
    if (part) {
      const problem = latexProblem(after);
      if (problem) {
        drop(problem);
        continue;
      }
      warnings.push(...editWarnings(label, before, after, groundMetrics));
      if (part.kind === "skills") {
        const lost = droppedItems(before, after);
        if (lost.length) warnings.push(`${label}: dropped ${lost.join(", ")}`);
      }
    }
    proposals.push({ target, label, before, after, why: typeof why === "string" ? why : "", warnings });
  }
  return { proposals, dropped };
}
