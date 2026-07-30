import type { ExtractedContent } from "../jd";
import { textOf, attrOf } from "./util";

export function extract(doc: Document): ExtractedContent {
  return {
    jobTitle: textOf(doc, [".iCIMS_Header h1", "h1.iCIMS_InfoMsg_Job", "h1"]),
    company:
      attrOf(doc, "meta[property='og:site_name']", "content") ||
      textOf(doc, [".iCIMS_CompanyName"]),
    jobDescription: textOf(doc, [
      ".iCIMS_JobContent",
      ".iCIMS_InfoMsg_Job",
      ".iCIMS_Expandable_Container",
    ]),
  };
}
