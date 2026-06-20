import { describe, it, expect } from "vitest";
import { parseJD } from "../../packages/skill/src/stages/parse-jd";

describe("parseJD", () => {
  it("extracts seniority and years", () => {
    const jd = parseJD("Senior Rust Engineer with 5+ years of experience.");
    expect(jd.seniority).toBe("senior");
    expect(jd.yearsRequired).toBe(5);
  });

  it("extracts known tech keywords", () => {
    const jd = parseJD(
      "You will work with Rust, PostgreSQL, Docker and async programming.",
    );
    expect(jd.keywords).toContain("rust");
    expect(jd.keywords).toContain("postgresql");
    expect(jd.keywords).toContain("docker");
  });

  it("splits must-haves from nice-to-haves", () => {
    const jd = parseJD(
      "Required: Rust. Nice to have: Kubernetes experience is a plus.",
    );
    expect(jd.mustHaves.join(" ").toLowerCase()).toContain("rust");
    expect(jd.niceToHaves.join(" ").toLowerCase()).toContain("kubernetes");
  });

  it("returns unknown seniority when unspecified", () => {
    const jd = parseJD("We build cool things.");
    expect(jd.seniority).toBe("unknown");
    expect(jd.yearsRequired).toBeNull();
  });
});
