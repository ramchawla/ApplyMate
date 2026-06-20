import type {
  ApplyJobOutput,
  ParsedJD,
  RetrievedExperience,
  BulletRewrite,
} from "./types";
import { buildReport } from "./stages/rewrite";

export interface ComposeInput {
  parsedJD: ParsedJD;
  retrieved: RetrievedExperience[];
  rewrites: BulletRewrite[];
  resumeLatex: string;
  coverLetter: string;
  formFieldGuidance?: ApplyJobOutput["formFieldGuidance"];
  reasoning?: string;
}

export function composeOutput(input: ComposeInput): ApplyJobOutput {
  const report = buildReport(input.rewrites);

  const reasoning =
    input.reasoning ??
    `Parsed ${input.parsedJD.keywords.length} keywords; retrieved ${input.retrieved.length} experiences; ${report.summary}`;

  return {
    parsedJD: input.parsedJD,
    retrievedExperiences: input.retrieved,
    resumeLatex: input.resumeLatex,
    coverLetter: input.coverLetter,
    rewritingReport: report,
    formFieldGuidance: input.formFieldGuidance ?? [],
    reasoning,
  };
}

export { parseJD } from "./stages/parse-jd";
export { retrieve } from "./stages/retrieve";
export { validateRewrite, buildReport } from "./stages/rewrite";
export { assembleLatex } from "./stages/assemble-latex";
export { assembleCoverLetter } from "./stages/cover-letter";
export { loadCorpus } from "./corpus/load";
export { connect, migrate, upsertAnchors, knnSearch } from "./db/pgvector";
export { embed, embedBatch } from "./embeddings/embedder";
