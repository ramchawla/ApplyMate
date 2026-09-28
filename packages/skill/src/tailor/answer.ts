import { FORM_ANSWERS, UNTRUSTED_LINE, parseAnswers, questionLines } from "./prompt";
import type { ClaudeRunner } from "./claude-cli";
import type { TailorRequest } from "../../../../lib/shared/types";

// Answers-only call for wizard steps after the first: no resume parts, no
// compile — just the questions on this step.
export type AnswerRequest = Pick<TailorRequest, "job" | "fields">;
export type Answers = { answers: { fieldId: string; value: string }[] };

export const ANSWER_SYSTEM = `You draft one software engineer's answers to job application form questions. Respond only through the structured output schema.

${UNTRUSTED_LINE}

${FORM_ANSWERS}`;

const str = { type: "string" } as const;
export const ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answers"],
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fieldId", "value"],
        properties: { fieldId: str, value: str },
      },
    },
  },
};

export function buildAnswerPrompt(
  req: AnswerRequest,
  files: { corpusYaml: string; profileYaml: string },
): string {
  return [
    "# Job",
    `Title: ${req.job.title || "(unknown)"}`,
    `Company: ${req.job.company || "(unknown)"}`,
    `URL: ${req.job.url}`,
    "",
    "## Job description",
    req.job.description?.trim() || "(not available)",
    "",
    "# Application form questions",
    ...questionLines(req.fields),
    "",
    "# Experience corpus (ground truth about the candidate)",
    files.corpusYaml.trim() || "(none)",
    "",
    "# Candidate profile",
    files.profileYaml.trim() || "(none)",
  ].join("\n");
}

export async function answerQuestions(
  req: AnswerRequest,
  files: { corpusYaml: string; profileYaml: string },
  deps: { runClaude: ClaudeRunner; claudeCwd?: string },
): Promise<Answers> {
  const raw = await deps.runClaude({
    system: ANSWER_SYSTEM,
    prompt: buildAnswerPrompt(req, files),
    schema: ANSWER_SCHEMA,
    cwd: deps.claudeCwd,
  });
  const asked = new Set(req.fields.map((f) => f.fieldId));
  const answers = parseAnswers((raw as { answers?: unknown } | null)?.answers);
  return { answers: answers.filter((a) => asked.has(a.fieldId)) };
}
