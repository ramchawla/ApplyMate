import { describe, it, expect } from "vitest";
import { extractJD } from "../../packages/extension/src/content/extractors/index";

describe("JD Extraction", () => {
  it("should extract job description text from generic page", () => {
    const html = `
      <h1>Senior Rust Engineer</h1>
      <p>Company: Acme Corp</p>
      <div class="job-posting">
        We are looking for a Senior Rust Engineer with 5+ years of experience.
        Required skills: Rust, async/await, systems programming.
      </div>
    `;

    const result = extractJD(html, "generic");

    expect(result.jobDescription).toContain("Senior Rust Engineer");
    expect(result.jobDescription.length).toBeGreaterThan(50);
  });

  it("should extract job title from heading", () => {
    const html = `
      <h1>Senior Rust Engineer</h1>
      <p>Company: Acme Corp</p>
      <div class="job-posting">Job details...</div>
    `;

    const result = extractJD(html, "generic");

    expect(result.jobTitle).toContain("Senior Rust Engineer");
  });

  it("should extract company name", () => {
    const html = `
      <h1>Backend Engineer</h1>
      <p>Company: Acme Corp</p>
      <div>Details</div>
    `;

    const result = extractJD(html, "generic");

    expect(result.company).toContain("Acme Corp");
  });

  it("should strip script and style tags from JD", () => {
    const html = `
      <h1>Role</h1>
      <script>alert('x')</script>
      <style>.a{color:red}</style>
      <div>Real job content here that is long enough to keep.</div>
    `;

    const result = extractJD(html, "generic");

    expect(result.jobDescription).not.toContain("alert");
    expect(result.jobDescription).not.toContain("color:red");
    expect(result.jobDescription).toContain("Real job content");
  });
});
