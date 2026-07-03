import type { ExtractedJobData } from "../types";

// Builds a self-contained prompt for the manual LLM path: the user pastes it
// into claude.ai (their Claude Pro subscription — no API, no cost), appends
// their experience corpus + resume bullets where marked, and saves Claude's
// JSON reply to a file for `pnpm skill:manual <file>`. The local CLI re-runs
// the anti-hallucination validators on everything the LLM proposes, so this
// prompt is guidance, not the safeguard.
export function buildManualPrompt(data: ExtractedJobData): string {
  const customQuestions = data.formFields
    .filter(
      (f) =>
        (f.userSelectedValueType ?? f.extractedValueType) === "custom-q",
    )
    .map((f) => `- fieldId: "${f.id}" — ${f.label}`)
    .join("\n");

  return `You are tailoring a resume for a specific job. Follow every rule exactly.

JOB
- Title: ${data.jobTitle}
- Company: ${data.company}
- URL: ${data.url}

JOB DESCRIPTION
"""
${data.jobDescription}
"""
${
  customQuestions
    ? `\nAPPLICATION FORM QUESTIONS (suggest an answer for each)\n${customQuestions}\n`
    : ""
}
MY EXPERIENCE CORPUS (paste the full contents of ~/.applymate/experience.yaml below)
"""
<PASTE experience.yaml HERE>
"""

MY CURRENT RESUME BULLETS (paste each bullet you want tailored, one per line)
"""
<PASTE RESUME BULLETS HERE>
"""

RULES (non-negotiable — a local validator re-checks all of them)
1. Rewrite each bullet's PHRASING to integrate keywords from the job
   description, but only claim skills that appear in my experience corpus.
2. Never invent or alter metrics. A number in the original bullet must appear
   verbatim in the revision or be dropped — never changed.
3. Never claim anything listed under "not_done" in the corpus.
4. List every keyword you added per bullet — the validator checks each one
   against the corpus and rejects unsupported claims.
5. Cover letter: 2-3 short grounded paragraphs, no clichés, no invented facts.

OUTPUT — reply with ONLY this JSON (no prose, no code fence):
{
  "job": {
    "company": ${JSON.stringify(data.company)},
    "jobTitle": ${JSON.stringify(data.jobTitle)},
    "jobUrl": ${JSON.stringify(data.url)},
    "jobDescription": <the full job description above, as a JSON string>
  },
  "bullets": [
    {
      "original": "<bullet exactly as I provided it>",
      "revised": "<your rewrite>",
      "keywordsAdded": ["<keyword>", "..."],
      "reasonsForAddition": ["<why, citing a corpus entry id>", "..."]
    }
  ],
  "coverLetterParagraphs": ["<paragraph 1>", "<paragraph 2>"],
  "formFieldGuidance": [
    { "fieldId": "<fieldId from above>", "suggestedAnswer": "<answer>" }
  ]
}`;
}
