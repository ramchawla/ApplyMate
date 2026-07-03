import { DetectionResult } from "../../../../../lib/shared/types";
import { DetectionInput } from "./index";
import { extractJsonLdJobPosting } from "../extractors/jd";

export function detectGeneric(input: DetectionInput): DetectionResult {
  // schema.org JobPosting in JSON-LD is a strong signal this is a job page,
  // whatever the ATS — carried by most career pages for Google Jobs indexing.
  if (extractJsonLdJobPosting(input.html)) {
    return {
      board: "generic",
      confidence: 0.75,
      method: "dom_structure",
      detectedElements: {
        jdContainer: "script[type='application/ld+json'] JobPosting",
      },
    };
  }

  const textareaCount = (input.html.match(/<textarea/g) || []).length;
  const inputCount = (input.html.match(/<input/g) || []).length;
  const totalFormElements = textareaCount + inputCount;

  const hasLargeTextContent = input.html.length > 500;

  if (totalFormElements >= 3 && hasLargeTextContent) {
    return {
      board: "generic",
      confidence: 0.3,
      method: "fallback",
      detectedElements: {
        formContainer: "form (generic)",
      },
    };
  }

  return {
    board: "unknown",
    confidence: 0,
    method: "fallback",
    detectedElements: {},
  };
}
