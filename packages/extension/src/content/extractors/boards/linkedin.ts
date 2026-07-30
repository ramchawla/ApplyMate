import type { ExtractedContent } from "../jd";
import { textOf } from "./util";

export function extract(doc: Document): ExtractedContent {
  return {
    jobTitle: textOf(doc, [
      ".job-details-jobs-unified-top-card__job-title",
      ".topcard__title",
      "h1",
    ]),
    company: textOf(doc, [
      ".job-details-jobs-unified-top-card__company-name",
      ".topcard__org-name-link",
    ]),
    jobDescription: textOf(doc, [
      ".jobs-description__content",
      ".description__text",
    ]),
  };
}
