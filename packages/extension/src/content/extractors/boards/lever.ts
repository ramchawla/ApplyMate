import type { ExtractedContent } from "../jd";
import { textOf, attrOf } from "./util";

export function extract(doc: Document): ExtractedContent {
  return {
    jobTitle: textOf(doc, [".posting-headline h2", "h2"]),
    company: attrOf(doc, "meta[property='og:site_name']", "content"),
    jobDescription: textOf(doc, [
      ".section-wrapper.page-full-width",
      ".section[data-qa='job-description']",
      ".content",
    ]),
  };
}
