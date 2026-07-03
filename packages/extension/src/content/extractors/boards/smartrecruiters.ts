import type { ExtractedContent } from "../jd";
import { textOf, attrOf } from "./util";

export function extract(doc: Document): ExtractedContent {
  return {
    jobTitle: textOf(doc, [".job-title", "h1[itemprop='title']", "h1"]),
    company:
      textOf(doc, ["[itemprop='hiringOrganization']", ".company-name"]) ||
      attrOf(doc, "meta[property='og:site_name']", "content"),
    jobDescription: textOf(doc, [
      "#st-jobDescription",
      "[itemprop='description']",
      ".job-sections",
    ]),
  };
}
