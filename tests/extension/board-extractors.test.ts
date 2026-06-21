import { describe, it, expect } from "vitest";
import { extract as extractLinkedIn } from "../../packages/extension/src/content/extractors/boards/linkedin";
import { extract as extractGreenhouse } from "../../packages/extension/src/content/extractors/boards/greenhouse";
import { extract as extractLever } from "../../packages/extension/src/content/extractors/boards/lever";
import { extract as extractAshby } from "../../packages/extension/src/content/extractors/boards/ashby";
import { extract as extractWorkday } from "../../packages/extension/src/content/extractors/boards/workday";

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

describe("board extractors: lever", () => {
  it("pulls title and JD from Lever markup", () => {
    const d = doc(`
      <div class="posting-headline"><h2>Platform Engineer</h2></div>
      <div class="section-wrapper page-full-width">Kafka and Kubernetes at scale.</div>
    `);
    const r = extractLever(d);
    expect(r.jobTitle).toBe("Platform Engineer");
    expect(r.jobDescription).toContain("Kafka");
  });
});

describe("board extractors: ashby", () => {
  it("pulls title and JD from Ashby markup", () => {
    const d = doc(`
      <h1>Founding Engineer</h1>
      <div class="_descriptionText_abc123">Rust, TypeScript, and distributed systems.</div>
    `);
    const r = extractAshby(d);
    expect(r.jobTitle).toBe("Founding Engineer");
    expect(r.jobDescription).toContain("distributed systems");
  });
});

describe("board extractors: workday", () => {
  it("pulls title and JD from Workday automation ids", () => {
    const d = doc(`
      <h2 data-automation-id="jobPostingHeader">Software Engineer II</h2>
      <div data-automation-id="jobPostingDescription">Java, Spring, and AWS.</div>
    `);
    const r = extractWorkday(d);
    expect(r.jobTitle).toBe("Software Engineer II");
    expect(r.jobDescription).toContain("Spring");
  });
});
