import type { InvariantResult } from "./invariant-checks";

export interface PlausibilityInput {
  invariant: InvariantResult;
  logicalExtensions: number;
  lowConfidenceMatches: number;
}

const FLOOR = 0.5;
const BASE = 0.9;

export function scorePlausibility(input: PlausibilityInput): number {
  if (!input.invariant.passed) return FLOOR;

  let score =
    BASE - 0.05 * input.logicalExtensions - 0.1 * input.lowConfidenceMatches;

  if (score < FLOOR) score = FLOOR;
  if (score > 1) score = 1;
  return Number(score.toFixed(5));
}
