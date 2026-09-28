import { parseResume, renderResume } from "./resume-doc";
import { latexProblem, editWarnings, keywordWarnings } from "./checks";
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

export interface TailorDeps {
  runClaude: ClaudeRunner;
  compile: (latex: string) => Promise<{ pdf: Buffer; pages: number }>;
  claudeCwd?: string;
}

export interface TailorOutcome {
  tex: string;
  pdf: Buffer;
  pages: number;
  coverLetter: string;
  coverLetterPdf?: Buffer;
  answers: { fieldId: string; value: string }[];
  keywords: KeywordReport;
  edits: EditRecord[];
  warnings: string[];
}

const MAX_FIT_ROUNDS = 10;

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
    else warnings.push(...editWarnings(e.id, part.text, e.latex, groundMetrics));
  }

  const order: Record<string, string[]> = {};
  for (const o of out.order) {
    const group = doc.groups.find((g) => g.id === o.role);
    if (!group) warnings.push(`Ignored a reorder for unknown role ${o.role}`);
    else order[o.role] = o.ids; // renderResume ignores non-permutations
  }

  warnings.push(...keywordWarnings(out.keywords.injected, groundText));

  const active = () =>
    Object.fromEntries(edits.filter((e) => !e.reverted).map((e) => [e.id, e.after]));

  let tex = renderResume(doc, active(), order);
  let compiled: { pdf: Buffer; pages: number };
  try {
    compiled = await deps.compile(tex);
    for (let round = 0; compiled.pages > 1 && round < MAX_FIT_ROUNDS; round++) {
      const victim = edits
        .filter((e) => !e.reverted)
        .sort(
          (a, b) => b.after.length - b.before.length - (a.after.length - a.before.length),
        )[0];
      if (!victim) break;
      victim.reverted = "reverted to keep the resume on one page";
      tex = renderResume(doc, active(), order);
      compiled = await deps.compile(tex);
    }
    if (compiled.pages > 1) {
      warnings.push(`Resume is ${compiled.pages} pages even with all edits reverted`);
    }
  } catch (err) {
    for (const e of edits) e.reverted ??= "compile error";
    warnings.push(
      `Tailored resume failed to compile, so ApplyMate fell back to your master resume: ${String(
        (err as Error).message,
      ).slice(0, 200)}`,
    );
    tex = files.masterTex;
    compiled = await deps.compile(tex);
  }

  let coverLetterPdf: Buffer | undefined;
  if (req.wantCoverLetterPdf && out.coverLetter.trim()) {
    const { first, last } = profileName(files.profileYaml);
    coverLetterPdf = (
      await deps.compile(coverLetterTex(`${first} ${last}`.trim(), out.coverLetter))
    ).pdf;
  }

  return {
    tex,
    pdf: compiled.pdf,
    pages: compiled.pages,
    coverLetter: out.coverLetter,
    coverLetterPdf,
    answers: out.answers,
    keywords: out.keywords,
    edits,
    warnings,
  };
}
