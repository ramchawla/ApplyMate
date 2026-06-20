import { describe, it, expect } from "vitest";
import { assembleCoverLetter } from "../../packages/skill/src/stages/cover-letter";
import { parseJD } from "../../packages/skill/src/stages/parse-jd";

describe("assembleCoverLetter", () => {
  it("includes company, title, body, and a sign-off", () => {
    const md = assembleCoverLetter({
      company: "Acme Corp",
      jobTitle: "Senior Rust Engineer",
      bodyParagraphs: [
        "I have built async Rust systems for years.",
        "Your focus on reliability matches my background.",
      ],
      parsedJD: parseJD("Senior Rust Engineer, async, 5+ years."),
      topExperiences: [],
    });
    expect(md).toContain("Acme Corp");
    expect(md).toContain("Senior Rust Engineer");
    expect(md).toContain("async Rust systems");
    expect(md).toMatch(/Sincerely/i);
  });

  it("falls back to a generated paragraph when none provided", () => {
    const md = assembleCoverLetter({
      company: "Acme",
      jobTitle: "Engineer",
      bodyParagraphs: [],
      parsedJD: parseJD("Engineer with rust."),
      topExperiences: [],
    });
    expect(md.length).toBeGreaterThan(40);
    expect(md).toContain("Acme");
  });
});
