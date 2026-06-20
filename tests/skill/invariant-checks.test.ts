import { describe, it, expect } from "vitest";
import {
  extractMetrics,
  findUnsupportedKeywords,
  checkInvariants,
} from "../../packages/skill/src/validators/invariant-checks";
import type { ExperienceAnchor } from "../../packages/skill/src/types";

const anchors: ExperienceAnchor[] = [
  {
    id: "rust-async-http",
    title: "Rust async HTTP server",
    description: "",
    skills: ["rust", "async", "concurrency", "http"],
    metrics: ["10k req/s", "sub-100ms latency"],
    tags: ["backend", "performance"],
    claimAnchor: "Expert in async Rust",
  },
  {
    id: "pg",
    title: "Postgres migration",
    description: "",
    skills: ["postgres", "sql"],
    metrics: ["50M rows"],
    tags: ["databases"],
    claimAnchor: "DB reliability",
  },
];

describe("extractMetrics", () => {
  it("pulls numeric metrics from text", () => {
    expect(extractMetrics("handled 10k req/s at sub-100ms latency")).toEqual(
      expect.arrayContaining(["10k", "100ms"]),
    );
  });
  it("captures plain numbers and percentages", () => {
    expect(extractMetrics("reduced cost by 40% across 5 services")).toEqual(
      expect.arrayContaining(["40%", "5"]),
    );
  });
});

describe("findUnsupportedKeywords", () => {
  it("returns empty when all keywords are in the corpus", () => {
    expect(findUnsupportedKeywords(["rust", "async"], anchors)).toEqual([]);
  });
  it("flags a keyword absent from every anchor", () => {
    expect(findUnsupportedKeywords(["kubernetes"], anchors)).toEqual([
      "kubernetes",
    ]);
  });
  it("is case-insensitive", () => {
    expect(findUnsupportedKeywords(["Rust", "ASYNC"], anchors)).toEqual([]);
  });
});

describe("checkInvariants", () => {
  it("passes a clean exact-match rewrite", () => {
    const r = checkInvariants({
      original: "Built HTTP server in Rust, 10k req/s",
      revised: "Built async HTTP server in Rust, 10k req/s",
      addedKeywords: ["async"],
      anchors,
      jdSeniority: "senior",
    });
    expect(r.passed).toBe(true);
    expect(r.metricsPreserved).toBe(true);
    expect(r.unsupportedKeywords).toEqual([]);
  });

  it("fails when an original metric is dropped", () => {
    const r = checkInvariants({
      original: "Migrated 50M rows in a 2hr window",
      revised: "Migrated a very large table quickly",
      addedKeywords: [],
      anchors,
      jdSeniority: "senior",
    });
    expect(r.passed).toBe(false);
    expect(r.metricsPreserved).toBe(false);
    expect(r.droppedMetrics).toEqual(expect.arrayContaining(["50m", "2"]));
  });

  it("fails when a metric value is altered", () => {
    const r = checkInvariants({
      original: "Handled 10k req/s",
      revised: "Handled 20k req/s",
      addedKeywords: [],
      anchors,
      jdSeniority: "senior",
    });
    expect(r.passed).toBe(false);
    expect(r.metricsPreserved).toBe(false);
  });

  it("fails when an unsupported keyword is injected", () => {
    const r = checkInvariants({
      original: "Deployed with Docker",
      revised: "Deployed with Docker, orchestrated Kubernetes",
      addedKeywords: ["kubernetes"],
      anchors,
      jdSeniority: "senior",
    });
    expect(r.passed).toBe(false);
    expect(r.unsupportedKeywords).toEqual(["kubernetes"]);
  });

  it("flags seniority inflation when corpus is junior but JD is staff", () => {
    const r = checkInvariants({
      original: "Junior engineer for 1 year",
      revised: "Staff engineer leading the org for 1 year",
      addedKeywords: [],
      anchors,
      jdSeniority: "staff",
    });
    expect(r.seniorityInflated).toBe(true);
    expect(r.passed).toBe(false);
  });

  it("allows adding a supported metric already present in the original", () => {
    const r = checkInvariants({
      original: "Built server, 10k req/s, sub-100ms latency",
      revised: "Built async server, 10k req/s, sub-100ms latency",
      addedKeywords: ["async"],
      anchors,
      jdSeniority: "mid",
    });
    expect(r.passed).toBe(true);
  });
});
