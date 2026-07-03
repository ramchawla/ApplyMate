import type { ApplyJobOutput, ExperienceAnchor } from "../types";
import type { RewriteCandidate } from "../stages/rewrite";
import { parseJD } from "../stages/parse-jd";
import { retrieveInMemory } from "../stages/retrieve";
import { validateRewrite } from "../stages/rewrite";
import { assembleLatex } from "../stages/assemble-latex";
import { assembleCoverLetter } from "../stages/cover-letter";
import { composeOutput } from "../index";
import { extractTechKeywords } from "../../../../lib/shared/keywords";

// The JSON the user pastes back from Claude (browser, Pro subscription).
// The LLM only proposes; every candidate still goes through the same
// code-side validators as the Claude Code skill path — the anti-hallucination
// safeguard never depends on the LLM following instructions.
export interface ManualLLMResponse {
  job: {
    company: string;
    jobTitle: string;
    jobUrl: string;
    jobDescription: string;
  };
  bullets: RewriteCandidate[];
  coverLetterParagraphs: string[];
  formFieldGuidance?: {
    fieldId: string;
    suggestedAnswer: string;
    relatedBullets?: string[];
  }[];
}

export interface ManualProcessResult {
  output: ApplyJobOutput;
  job: ManualLLMResponse["job"];
}

export function parseManualResponse(raw: string): ManualLLMResponse {
  // Tolerate a response wrapped in a markdown code fence.
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error("Response is not valid JSON (after stripping code fences).");
  }
  const r = parsed as Partial<ManualLLMResponse>;
  if (!r.job?.company || !r.job.jobTitle || !r.job.jobDescription) {
    throw new Error(
      "Response JSON must include job.company, job.jobTitle, job.jobDescription.",
    );
  }
  // Bullets may be empty for the answers-only flow (custom-question drafts
  // without a resume regen) — but then formFieldGuidance must carry content.
  if (!Array.isArray(r.bullets)) r.bullets = [];
  if (
    r.bullets.length === 0 &&
    (!Array.isArray(r.formFieldGuidance) || r.formFieldGuidance.length === 0)
  ) {
    throw new Error(
      "Response JSON must include bullets, or formFieldGuidance for the answers-only flow.",
    );
  }
  for (const b of r.bullets) {
    if (
      typeof b.original !== "string" ||
      typeof b.revised !== "string" ||
      !Array.isArray(b.keywordsAdded)
    ) {
      throw new Error(
        "Each bullet needs string original/revised and a keywordsAdded array.",
      );
    }
    b.reasonsForAddition = Array.isArray(b.reasonsForAddition)
      ? b.reasonsForAddition
      : [];
  }
  if (!Array.isArray(r.coverLetterParagraphs)) r.coverLetterParagraphs = [];
  return {
    job: { ...r.job, jobUrl: r.job.jobUrl ?? "" } as ManualLLMResponse["job"],
    bullets: r.bullets,
    coverLetterParagraphs: r.coverLetterParagraphs,
    formFieldGuidance: r.formFieldGuidance ?? [],
  };
}

export async function processManualResponse(
  response: ManualLLMResponse,
  anchors: ExperienceAnchor[],
  template: string,
): Promise<ManualProcessResult> {
  const parsedJD = parseJD(response.job.jobDescription);
  const retrieved = await retrieveInMemory(parsedJD, anchors, 8);

  const rewrites = response.bullets.map((candidate) =>
    validateRewrite(candidate, anchors, parsedJD),
  );

  const resumeLatex = assembleLatex(template, rewrites);
  const coverLetter = assembleCoverLetter({
    company: response.job.company,
    jobTitle: response.job.jobTitle,
    bodyParagraphs: response.coverLetterParagraphs,
    parsedJD,
    topExperiences: retrieved.slice(0, 5),
  });

  // Answers get the same grounding scrutiny as bullets: any tech claim in a
  // suggested answer must be backed by a corpus anchor, or it's flagged.
  const corpusSkills = new Set(
    anchors.flatMap((a) => a.skills.map((s) => s.toLowerCase())),
  );
  const answerWarnings = (response.formFieldGuidance ?? []).flatMap((g) => {
    const unsupported = extractTechKeywords(g.suggestedAnswer).filter(
      (k) => !corpusSkills.has(k),
    );
    return unsupported.length > 0
      ? [
          `Answer for "${g.fieldId}" claims skills not in corpus: ${unsupported.join(", ")}`,
        ]
      : [];
  });

  const output = composeOutput({
    parsedJD,
    retrieved,
    rewrites,
    resumeLatex,
    coverLetter,
    formFieldGuidance: (response.formFieldGuidance ?? []).map((g) => ({
      fieldId: g.fieldId,
      suggestedAnswer: g.suggestedAnswer,
      relatedBullets: g.relatedBullets ?? [],
    })),
    reasoning:
      "Manual LLM path: candidate rewrites pasted from Claude (browser), validated locally.",
  });
  output.rewritingReport.warnings.push(...answerWarnings);

  return { output, job: response.job };
}
