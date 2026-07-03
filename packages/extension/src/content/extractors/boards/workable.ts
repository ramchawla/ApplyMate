import type { ExtractedContent } from "../jd";
import { textOf, attrOf } from "./util";

export function extract(doc: Document): ExtractedContent {
  return {
    jobTitle: textOf(doc, ['[data-ui="job-title"]', "h1"]),
    company:
      textOf(doc, ['[data-ui="company-name"]']) ||
      attrOf(doc, "meta[property='og:site_name']", "content"),
    jobDescription: textOf(doc, [
      '[data-ui="job-description"]',
      'section[data-ui="job-details"]',
      "main section",
    ]),
  };
}
