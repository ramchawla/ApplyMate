import { describe, it, expect } from "vitest";
import { scorePlausibility } from "../../packages/skill/src/validators/plausibility";
import type { InvariantResult } from "../../packages/skill/src/validators/invariant-checks";

const clean: InvariantResult = {
  passed: true,
  metricsPreserved: true,
  droppedMetrics: [],
  unsupportedKeywords: [],
  seniorityInflated: false,
  notes: [],
};

describe("scorePlausibility", () => {
  it("scores a clean exact-match rewrite high", () => {
    const s = scorePlausibility({
      invariant: clean,
      logicalExtensions: 0,
      lowConfidenceMatches: 0,
    });
    expect(s).toBeCloseTo(0.9, 5);
  });

  it("drops 0.05 per logical extension", () => {
    const s = scorePlausibility({
      invariant: clean,
      logicalExtensions: 2,
      lowConfidenceMatches: 0,
    });
    expect(s).toBeCloseTo(0.8, 5);
  });

  it("never scores below the 0.5 floor", () => {
    const s = scorePlausibility({
      invariant: clean,
      logicalExtensions: 20,
      lowConfidenceMatches: 20,
    });
    expect(s).toBe(0.5);
  });

  it("scores a failed-invariant rewrite at the floor", () => {
    const failed: InvariantResult = {
      ...clean,
      passed: false,
      metricsPreserved: false,
    };
    const s = scorePlausibility({
      invariant: failed,
      logicalExtensions: 0,
      lowConfidenceMatches: 0,
    });
    expect(s).toBe(0.5);
  });
});
