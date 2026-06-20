import { describe, it, expect } from "vitest";
import {
  validateRewrite,
  buildReport,
} from "../../packages/skill/src/stages/rewrite";
import { parseJD } from "../../packages/skill/src/stages/parse-jd";
import type { ExperienceAnchor } from "../../packages/skill/src/types";

const anchors: ExperienceAnchor[] = [
  {
    id: "rust",
    title: "Rust services",
    description: "",
    skills: ["rust", "async"],
    metrics: ["10k req/s"],
    tags: ["backend"],
    claimAnchor: "async Rust",
  },
];
const jd = parseJD("Senior Rust Engineer with Kubernetes.");

describe("resume accuracy guard", () => {
  it("blocks an unsupported keyword no matter how it is proposed", () => {
    const attempts = [
      "Built Rust services, deployed on Kubernetes",
      "Operated Kubernetes clusters for Rust apps",
      "Kubernetes-native Rust microservices",
    ];
    for (const revised of attempts) {
      const r = validateRewrite(
        {
          original: "Built Rust services, 10k req/s",
          revised,
          keywordsAdded: ["kubernetes"],
          reasonsForAddition: ["jd asked"],
        },
        anchors,
        jd,
      );
      expect(r.invariantChecksPassed).toBe(false);
      expect(r.plausibilityScore).toBe(0.5);
    }
  });

  it("preserves metrics — altering a number fails", () => {
    const r = validateRewrite(
      {
        original: "Built Rust services, 10k req/s",
        revised: "Built async Rust services, 50k req/s",
        keywordsAdded: ["async"],
        reasonsForAddition: ["supported"],
      },
      anchors,
      jd,
    );
    expect(r.invariantChecksPassed).toBe(false);
  });

  it("accepts a fully supported rewrite", () => {
    const r = validateRewrite(
      {
        original: "Built Rust services, 10k req/s",
        revised: "Built async Rust services, 10k req/s",
        keywordsAdded: ["async"],
        reasonsForAddition: ["supported by corpus"],
      },
      anchors,
      jd,
    );
    expect(r.invariantChecksPassed).toBe(true);
    const report = buildReport([r]);
    expect(report.allInvariantChecksPassed).toBe(true);
  });
});
