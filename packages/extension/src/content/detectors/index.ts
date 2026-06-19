import { DetectionResult } from "../../../../../lib/shared/types";
import { detectLinkedIn } from "./linkedin";
import { detectIndeed } from "./indeed";
import { detectGeneric } from "./generic";

export interface DetectionInput {
  url: string;
  html: string;
}

export function detect(input: DetectionInput): DetectionResult {
  let result = detectLinkedIn(input);
  if (result.confidence > 0.7) return result;

  result = detectIndeed(input);
  if (result.confidence > 0.7) return result;

  return detectGeneric(input);
}
