import { describe, it, expect } from "vitest";
import { detect } from "../../packages/extension/src/content/detectors/index";

describe("Board Detection", () => {
  it("should detect LinkedIn from URL pattern", () => {
    const result = detect({
      url: "https://www.linkedin.com/jobs/view/1234567890/",
      html: "",
    });

    expect(result.board).toBe("linkedin");
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    expect(result.method).toBe("url_pattern");
  });

  it("should detect Indeed from URL pattern", () => {
    const result = detect({
      url: "https://www.indeed.com/jobs?q=software",
      html: "",
    });

    expect(result.board).toBe("indeed");
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    expect(result.method).toBe("url_pattern");
  });

  it("should detect LinkedIn from DOM structure when URL absent", () => {
    const result = detect({
      url: "https://unknown.com/careers/role",
      html: '<textarea class="posting-description"></textarea>',
    });

    expect(result.board).toBe("linkedin");
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.method).toBe("dom_structure");
  });

  it("should fallback to generic for unknown form page", () => {
    const result = detect({
      url: "https://unknown-careers.com/jobs/123",
      html:
        "<textarea></textarea><input /><input /><p>" +
        "Job description text ".repeat(40) +
        "</p>",
    });

    expect(result.board).toBe("generic");
    expect(result.confidence).toBeLessThan(0.7);
    expect(result.method).toBe("fallback");
  });

  it("should return unknown for a page with no form and no match", () => {
    const result = detect({
      url: "https://example.com",
      html: "<p>hello</p>",
    });

    expect(result.board).toBe("unknown");
    expect(result.confidence).toBe(0);
  });
});
