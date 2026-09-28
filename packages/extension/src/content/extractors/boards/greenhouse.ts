import type { ExtractedContent } from "../jd";
import { textOf, attrOf } from "./util";

export function extract(doc: Document): ExtractedContent {
  return {
    jobTitle: textOf(doc, [".app-title", "h1.section-header", "h1"]),
    company:
      textOf(doc, [".company-name"]) ||
      // job-boards.greenhouse.io: "Job Application for <role> at <company>"
      (doc.title.match(/ at ([^|]+?)\s*$/)?.[1] ?? "") ||
      attrOf(doc, "meta[property='og:site_name']", "content"),
    jobDescription: textOf(doc, [
      "#content",
      ".job__description",
      "#job_description",
    ]),
  };
}
