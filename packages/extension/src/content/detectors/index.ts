import { DetectionResult } from "../../../../../lib/shared/types";
import { detectLinkedIn } from "./linkedin";
import { detectIndeed } from "./indeed";
import { detectGreenhouse } from "./greenhouse";
import { detectLever } from "./lever";
import { detectAshby } from "./ashby";
import { detectWorkday } from "./workday";
import { detectGeneric } from "./generic";

export interface DetectionInput {
  url: string;
  html: string;
}

export function detect(input: DetectionInput): DetectionResult {
  const boards = [
    detectLinkedIn,
    detectIndeed,
    detectGreenhouse,
    detectLever,
    detectAshby,
    detectWorkday,
  ];
  for (const fn of boards) {
    const result = fn(input);
    if (result.confidence > 0.7) return result;
  }
  return detectGeneric(input);
}
