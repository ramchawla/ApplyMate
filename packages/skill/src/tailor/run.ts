import { parseResume, renderResume, isPermutation } from "./resume-doc";
import { latexProblem, editWarnings, keywordWarnings, droppedItems } from "./checks";
import { buildTailorPrompt, parseTailorOutput, TAILOR_SCHEMA, TAILOR_SYSTEM } from "./prompt";
import { coverLetterTex, profileName } from "./letter";
import type { ClaudeRunner } from "./claude-cli";
import { extractMetrics } from "../validators/invariant-checks";
import type {
  EditRecord,
  KeywordReport,
  TailorRequest,
} from "../../../../lib/shared/types";

export interface TailorFiles {
  masterTex: string;
  corpusYaml: string;
  directives: string;
  profileYaml: string;
}

export interface Compiled {
  pdf: Buffer;
  pages: number;
  height?: number;
  goal?: number;
}

export interface TailorDeps {
  runClaude: ClaudeRunner;
  compile: (latex: string) => Promise<Compiled>;
  claudeCwd?: string;
}

export interface TailorOutcome {
  // The posting's title/company as Claude read them from the JD ("" = unknown).
  job: { title: string; company: string };
  tex: string;
  pdf: Buffer;
  pages: number;
  coverLetter: string;
  coverLetterPdf?: Buffer;
  answers: { fieldId: string; value: string }[];
  keywords: KeywordReport;
  // Only valid permutations that were rendered.
  order: Record<string, string[]>;
  edits: EditRecord[];
  warnings: string[];
}

const MAX_FIT_ROUNDS = 10;
// One text line (~11pt). TeX absorbs a single extra line in glue without
// headings colliding (checked visually on the real master); two lines don't.
const HEIGHT_SLACK_PT = 12;
const FIT_REVERT_REASON = "reverted to keep the resume on one page";

export async function tailorResume(
  req: TailorRequest,
  files: TailorFiles,
  deps: TailorDeps,
): Promise<TailorOutcome> {
  const doc = parseResume(files.masterTex);
  const raw = await deps.runClaude({
    system: TAILOR_SYSTEM,
    prompt: buildTailorPrompt(req, {
      doc,
      corpusYaml: files.corpusYaml,
      directives: files.directives,
      profileYaml: files.profileYaml,
    }),
    schema: TAILOR_SCHEMA,
    cwd: deps.claudeCwd,
  });
  const out = parseTailorOutput(raw);
  const asked = new Set(req.fields.map((f) => f.fieldId));

  const warnings: string[] = [];
  // Ground truth = corpus + the resume's own editable text. Not the whole
  // .tex: preamble layout numbers (10.75pt, 0.97\textwidth) would mask
  // invented metrics.
  const groundText = `${files.corpusYaml}\n${doc.parts.map((p) => p.text).join("\n")}`;
  const groundMetrics = new Set(extractMetrics(groundText));
  const partsById = new Map(doc.parts.map((p) => [p.id, p]));

  const edits: EditRecord[] = [];
  for (const e of out.edits) {
    const part = partsById.get(e.id);
    if (!part) {
      warnings.push(`Ignored an edit for unknown id ${e.id}`);
      continue;
    }
    if (e.latex.trim() === part.text.trim()) continue;
    const problem = latexProblem(e.latex);
    edits.push({ id: e.id, before: part.text, after: e.latex, reverted: problem ?? undefined });
    if (problem) warnings.push(`${e.id}: reverted (${problem})`);
    else {
      warnings.push(...editWarnings(e.id, part.text, e.latex, groundMetrics));
      if (part.kind === "skills") {
        const dropped = droppedItems(part.text, e.latex);
        if (dropped.length) warnings.push(`${e.id}: dropped ${dropped.join(", ")}`);
      }
    }
  }

  const order: Record<string, string[]> = {};
  for (const o of out.order) {
    const group = doc.groups.find((g) => g.id === o.role);
    if (!group) warnings.push(`Ignored a reorder for unknown role ${o.role}`);
    else if (isPermutation(o.ids, group.bulletIds)) order[o.role] = o.ids;
    else warnings.push(`Ignored a reorder for ${o.role}: not a permutation of its bullets`);
  }

  warnings.push(...keywordWarnings(out.keywords.injected, groundText));

  const active = () =>
    Object.fromEntries(edits.filter((e) => !e.reverted).map((e) => [e.id, e.after]));

  // "Fits" = one page AND no taller than the master's natural height. A
  // longer resume still compiles to one page because TeX shrinks glue, but
  // then headings collide with bullets; the master is the user's own
  // accepted density.
  const master = await deps.compile(files.masterTex);
  const budget = Math.max(master.height ?? 0, master.goal ?? 0);
  const fits = (c: Compiled) =>
    c.pages <= 1 && (!budget || !c.height || c.height <= budget + HEIGHT_SLACK_PT);

  let tex = renderResume(doc, active(), order);
  let compiled: Compiled;
  try {
    compiled = tex === files.masterTex ? master : await deps.compile(tex);
    for (let round = 0; !fits(compiled) && round < MAX_FIT_ROUNDS; round++) {
      const victim = edits
        .filter((e) => !e.reverted)
        .sort(
          (a, b) => b.after.length - b.before.length - (a.after.length - a.before.length),
        )[0];
      if (!victim) break;
      victim.reverted = FIT_REVERT_REASON;
      tex = renderResume(doc, active(), order);
      compiled = await deps.compile(tex);
    }
    // Greedy-by-characters over-reverts: an edit can grow a lot yet wrap
    // into the same lines. Try each fit-reverted edit back, smallest first.
    const growth = (e: EditRecord) => e.after.length - e.before.length;
    const retry = edits.filter((e) => e.reverted === FIT_REVERT_REASON).sort((a, b) => growth(a) - growth(b));
    for (const e of fits(compiled) ? retry : []) {
      e.reverted = undefined;
      const candidateTex = renderResume(doc, active(), order);
      const candidate = await deps.compile(candidateTex);
      if (fits(candidate)) {
        tex = candidateTex;
        compiled = candidate;
      } else {
        e.reverted = FIT_REVERT_REASON;
      }
    }
    if (!fits(compiled)) {
      warnings.push("Resume is longer than your master even with all edits reverted");
    }
  } catch (err) {
    for (const e of edits) e.reverted ??= "compile error";
    warnings.push(
      `Tailored resume failed to compile, so ApplyMate fell back to your master resume: ${String(
        (err as Error).message,
      ).slice(0, 200)}`,
    );
    tex = files.masterTex;
    compiled = master;
  }

  let coverLetterPdf: Buffer | undefined;
  if (req.wantCoverLetterPdf && out.coverLetter.trim()) {
    const { first, last } = profileName(files.profileYaml);
    coverLetterPdf = (
      await deps.compile(coverLetterTex(`${first} ${last}`.trim(), out.coverLetter))
    ).pdf;
  }

  return {
    job: out.job,
    tex,
    pdf: compiled.pdf,
    pages: compiled.pages,
    coverLetter: out.coverLetter,
    coverLetterPdf,
    // Only questions we asked: a hallucinated or JD-injected fieldId could
    // otherwise overwrite profile fields on the page (email, honeypots).
    answers: out.answers.filter((a) => asked.has(a.fieldId)),
    keywords: out.keywords,
    order,
    edits,
    warnings,
  };
}
