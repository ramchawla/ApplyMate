import { describe, it, expect } from "vitest";
import {
  validateRewrite,
  buildReport,
} from "../../packages/skill/src/stages/rewrite";
import type { ExperienceAnchor } from "../../packages/skill/src/types";
import { parseJD } from "../../packages/skill/src/stages/parse-jd";

const anchors: ExperienceAnchor[] = [
  {
    id: "rust-async-http",
    title: "Rust async HTTP server",
    description: "",
    skills: ["rust", "async", "concurrency", "http"],
    metrics: ["10k req/s"],
    tags: ["backend", "performance"],
    claimAnchor: "Expert in async Rust",
  },
];

const jd = parseJD("Senior Rust Engineer, async, 5+ years.");

describe("validateRewrite", () => {
  it("accepts a supported rewrite and scores it high", () => {
    const r = validateRewrite(
      {
        original: "Built HTTP server in Rust, 10k req/s",
        revised: "Built async HTTP server in Rust, 10k req/s",
        keywordsAdded: ["async"],
        reasonsForAddition: ["async: matches JD requirement"],
      },
      anchors,
      jd,
    );
    expect(r.invariantChecksPassed).toBe(true);
    expect(r.plausibilityScore).toBeGreaterThanOrEqual(0.85);
    expect(r.warnings).toEqual([]);
  });

  it("rejects an unsupported keyword and warns", () => {
    const r = validateRewrite(
      {
        original: "Deployed with Docker",
        revised: "Deployed with Docker and Kubernetes",
        keywordsAdded: ["kubernetes"],
        reasonsForAddition: ["k8s: JD asks for it"],
      },
      anchors,
      jd,
    );
    expect(r.invariantChecksPassed).toBe(false);
    expect(r.plausibilityScore).toBe(0.5);
    expect(r.warnings.join(" ")).toMatch(/kubernetes/i);
  });
});

describe("buildReport", () => {
  it("aggregates per-bullet results", () => {
    const good = validateRewrite(
      {
        original: "Built HTTP server in Rust, 10k req/s",
        revised: "Built async HTTP server in Rust, 10k req/s",
        keywordsAdded: ["async"],
        reasonsForAddition: ["async"],
      },
      anchors,
      jd,
    );
    const unchanged = validateRewrite(
      {
        original: "Mentored two engineers",
        revised: "Mentored two engineers",
        keywordsAdded: [],
        reasonsForAddition: [],
      },
      anchors,
      jd,
    );
    const report = buildReport([good, unchanged]);
    expect(report.totalBullets).toBe(2);
    expect(report.bulletsModified).toBe(1);
    expect(report.allInvariantChecksPassed).toBe(true);
    expect(report.overallConfidence).toBeGreaterThan(0.5);
  });
});
