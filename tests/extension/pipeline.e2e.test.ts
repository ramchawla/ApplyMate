import { describe, it, expect } from "vitest";
import { detect } from "../../packages/extension/src/content/detectors/index";
import {
  extractJD,
  extractFormFields,
} from "../../packages/extension/src/content/extractors/index";
import { buildFillPlan } from "../../packages/extension/src/lib/field-mapping";
import { applyFillPlan } from "../../packages/extension/src/content/fill";
import type { Profile } from "../../packages/extension/src/types";

const JOB_HTML = `
  <html><body>
    <h1>Senior Rust Engineer</h1>
    <p>Company: Acme Corp</p>
    <div class="posting-description">
      We need 5+ years of async Rust and systems programming.
    </div>
    <form>
      <label for="name">Full Name</label>
      <input id="name" type="text" />
      <label for="email">Email</label>
      <input id="email" type="email" />
      <label for="why">Why are you interested?</label>
      <textarea id="why"></textarea>
      <label for="resume">Resume</label>
      <input id="resume" type="file" />
    </form>
  </body></html>
`;

const profile: Profile = {
  fullName: "Jane Dev",
  email: "jane@example.com",
  phone: "555",
  linkedin: "",
  github: "",
  website: "",
};

const output = {
  coverLetter: "Dear Acme Corp...",
  formFieldGuidance: [
    { fieldId: "why", suggestedAnswer: "Your systems focus matches mine." },
  ],
};

describe("extension pipeline E2E", () => {
  it("detects, extracts, maps, and fills a realistic job page", () => {
    const detection = detect({
      url: "https://careers.acme.com/x",
      html: JOB_HTML,
    });
    expect(["linkedin", "generic"]).toContain(detection.board);

    const jd = extractJD(JOB_HTML, detection.board);
    expect(jd.jobTitle).toContain("Senior Rust Engineer");

    const fields = extractFormFields(JOB_HTML);
    const byType = (t: string) =>
      fields.find((f) => f.extractedValueType === t);
    expect(byType("name")).toBeTruthy();
    expect(byType("email")).toBeTruthy();
    expect(byType("custom-q")).toBeTruthy();

    fields.forEach((f) => (f.validated = true));
    const plan = buildFillPlan(fields, profile, output);
    expect(plan.instructions.find((i) => i.fieldId === "name")?.value).toBe(
      "Jane Dev",
    );
    expect(plan.instructions.find((i) => i.fieldId === "why")?.value).toBe(
      "Your systems focus matches mine.",
    );

    const doc = new DOMParser().parseFromString(JOB_HTML, "text/html");
    const result = applyFillPlan(plan.instructions, doc);
    expect((doc.getElementById("name") as HTMLInputElement).value).toBe(
      "Jane Dev",
    );
    expect((doc.getElementById("email") as HTMLInputElement).value).toBe(
      "jane@example.com",
    );
    expect(result.filled).toContain("why");
    expect(result.filled).not.toContain("resume");
  });
});
