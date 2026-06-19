import { DetectionResult } from "../../../../../lib/shared/types";
import { DetectionInput } from "./index";

export function detectGeneric(input: DetectionInput): DetectionResult {
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
