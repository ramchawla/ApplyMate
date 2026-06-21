import type { ExtractedContent } from "../jd";
import { textOf, attrOf } from "./util";

export function extract(doc: Document): ExtractedContent {
  return {
    jobTitle: textOf(doc, ["h1"]),
    company: attrOf(doc, "meta[property='og:site_name']", "content"),
    jobDescription: textOf(doc, ["[class*='descriptionText']", "main"]),
  };
}
