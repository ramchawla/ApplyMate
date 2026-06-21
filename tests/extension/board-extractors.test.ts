import { describe, it, expect } from "vitest";
import { extract as extractLinkedIn } from "../../packages/extension/src/content/extractors/boards/linkedin";
import { extract as extractGreenhouse } from "../../packages/extension/src/content/extractors/boards/greenhouse";

function doc(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("board extractors: linkedin", () => {
  it("pulls title, company, and JD from LinkedIn markup", () => {
    const d = doc(`
      <h1 class="job-details-jobs-unified-top-card__job-title">Senior Rust Engineer</h1>
      <a class="job-details-jobs-unified-top-card__company-name">Acme Corp</a>
      <div class="jobs-description__content">Build async Rust systems at scale.</div>
    `);
    const r = extractLinkedIn(d);
    expect(r.jobTitle).toBe("Senior Rust Engineer");
    expect(r.company).toBe("Acme Corp");
    expect(r.jobDescription).toContain("async Rust");
  });
});

describe("board extractors: greenhouse", () => {
  it("pulls title and JD from Greenhouse markup", () => {
    const d = doc(`
      <h1 class="app-title">Backend Engineer</h1>
      <div id="content">We need Go and Postgres experience.</div>
    `);
    const r = extractGreenhouse(d);
    expect(r.jobTitle).toBe("Backend Engineer");
    expect(r.jobDescription).toContain("Postgres");
  });
});
