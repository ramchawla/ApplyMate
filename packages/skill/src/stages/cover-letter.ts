import type { ParsedJD, RetrievedExperience } from "../types";

export interface CoverLetterInput {
  company: string;
  jobTitle: string;
  bodyParagraphs: string[];
  parsedJD: ParsedJD;
  topExperiences: RetrievedExperience[];
}

export function assembleCoverLetter(input: CoverLetterInput): string {
  const paragraphs =
    input.bodyParagraphs.length > 0
      ? input.bodyParagraphs
      : [fallbackParagraph(input)];

  const lines = [
    `Dear ${input.company} Hiring Team,`,
    "",
    `I am excited to apply for the ${input.jobTitle} role at ${input.company}.`,
    "",
    ...interleave(paragraphs),
    "",
    "Sincerely,",
  ];

  return lines.join("\n");
}

function interleave(paragraphs: string[]): string[] {
  const out: string[] = [];
  paragraphs.forEach((p, i) => {
    out.push(p);
    if (i < paragraphs.length - 1) out.push("");
  });
  return out;
}

function fallbackParagraph(input: CoverLetterInput): string {
  const skills = input.parsedJD.keywords.slice(0, 3).join(", ");
  const skillClause = skills ? ` with strength in ${skills}` : "";
  return `My background${skillClause} aligns closely with what ${input.company} is looking for, and I would bring that experience to the ${input.jobTitle} role.`;
}
