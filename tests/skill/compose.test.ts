import { describe, it, expect } from "vitest";
import { composeOutput } from "../../packages/skill/src/index";
import { parseJD } from "../../packages/skill/src/stages/parse-jd";
import { validateRewrite } from "../../packages/skill/src/stages/rewrite";
import type { ExperienceAnchor } from "../../packages/skill/src/types";

const anchors: ExperienceAnchor[] = [
  {
    id: "rust-async-http",
    title: "Rust async HTTP server",
    description: "",
    skills: ["rust", "async"],
    metrics: ["10k req/s"],
    tags: ["backend"],
    claimAnchor: "Expert in async Rust",
  },
];
const jd = parseJD("Senior Rust Engineer, async, 5+ years.");

describe("composeOutput", () => {
  it("assembles a complete ApplyJobOutput with a valid report", () => {
    const rw = validateRewrite(
      {
        original: "Built HTTP server in Rust, 10k req/s",
        revised: "Built async HTTP server in Rust, 10k req/s",
        keywordsAdded: ["async"],
        reasonsForAddition: ["async"],
      },
      anchors,
      jd,
    );
    const out = composeOutput({
      parsedJD: jd,
      retrieved: [{ anchor: anchors[0], relevanceScore: 0.8 }],
      rewrites: [rw],
      resumeLatex: "\\item Built async HTTP server",
      coverLetter: "Dear Acme...",
    });

    expect(out.rewritingReport.totalBullets).toBe(1);
    expect(out.rewritingReport.allInvariantChecksPassed).toBe(true);
    expect(out.resumeLatex).toContain("async");
    expect(out.retrievedExperiences[0].anchor.id).toBe("rust-async-http");
    expect(out.reasoning.length).toBeGreaterThan(0);
  });
});
