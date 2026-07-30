import { extractJDContent, ExtractedContent } from "./jd";
import { extract as linkedin } from "./boards/linkedin";
import { extract as greenhouse } from "./boards/greenhouse";
import { extract as lever } from "./boards/lever";
import { extract as ashby } from "./boards/ashby";
import { extract as workday } from "./boards/workday";
import { extract as icims } from "./boards/icims";
import { extract as workable } from "./boards/workable";
import { extract as smartrecruiters } from "./boards/smartrecruiters";

export type { ExtractedContent } from "./jd";
export { extractFormFields } from "./form";

const BOARD_EXTRACTORS: Record<string, (doc: Document) => ExtractedContent> = {
  linkedin,
  greenhouse,
  lever,
  ashby,
  workday,
  icims,
  workable,
  smartrecruiters,
};

export function extractJD(html: string, board: string): ExtractedContent {
  const boardExtract = BOARD_EXTRACTORS[board];
  if (boardExtract) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const result = boardExtract(doc);
    if (isComplete(result)) return result;
    // Partial board result: backfill missing fields from the generic extractor.
    const generic = extractJDContent(html);
    return {
      jobTitle: result.jobTitle || generic.jobTitle,
      company: result.company || generic.company,
      jobDescription: result.jobDescription || generic.jobDescription,
    };
  }
  return extractJDContent(html);
}

function isComplete(c: ExtractedContent): boolean {
  return (
    c.jobTitle.length > 0 &&
    c.company.length > 0 &&
    c.jobDescription.length > 0
  );
}
