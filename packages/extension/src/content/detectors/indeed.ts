import { BOARD_DETECTION_PATTERNS } from "../../../../../lib/shared/constants";
import { DetectionResult } from "../../../../../lib/shared/types";
import { DetectionInput } from "./index";

export function detectIndeed(input: DetectionInput): DetectionResult {
  const pattern = BOARD_DETECTION_PATTERNS.indeed;

  if (pattern.urlPattern.test(input.url)) {
    return {
      board: "indeed",
      confidence: pattern.confidence,
      method: "url_pattern",
      detectedElements: {},
    };
  }

  for (const selector of pattern.domSelectors) {
    if (input.html.includes(selector)) {
      return {
        board: "indeed",
        confidence: 0.8,
        method: "dom_structure",
        detectedElements: { jdContainer: selector },
      };
    }
  }

  return {
    board: "unknown",
    confidence: 0,
    method: "fallback",
    detectedElements: {},
  };
}
