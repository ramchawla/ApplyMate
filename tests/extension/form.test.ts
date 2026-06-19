import { describe, it, expect } from "vitest";
import { extractFormFields } from "../../packages/extension/src/content/extractors/form";

describe("Form Field Extraction", () => {
  it("should detect a name input field", () => {
    const html = `<input type="text" name="name" placeholder="Full Name" />`;
    const fields = extractFormFields(html);

    expect(fields).toHaveLength(1);
    expect(fields[0].extractedValueType).toBe("name");
    expect(fields[0].matchConfidence).toBeGreaterThan(0.7);
  });

  it("should detect an email input field", () => {
    const html = `<input type="email" name="email" placeholder="your@email.com" />`;
    const fields = extractFormFields(html);

    expect(fields[0].extractedValueType).toBe("email");
    expect(fields[0].matchConfidence).toBeGreaterThan(0.8);
  });

  it("should detect a resume file upload field via label", () => {
    const html = `<label for="r">Resume</label><input id="r" type="file" name="resume" accept=".pdf" />`;
    const fields = extractFormFields(html);

    const resumeField = fields.find((f) => f.type === "file");
    expect(resumeField).toBeDefined();
    expect(resumeField!.extractedValueType).toBe("resume");
  });

  it("should detect a custom question textarea via label", () => {
    const html = `<label for="q">Why are you interested in this role?</label><textarea id="q"></textarea>`;
    const fields = extractFormFields(html);

    const textarea = fields.find((f) => f.type === "textarea");
    expect(textarea).toBeDefined();
    expect(textarea!.extractedValueType).toBe("custom-q");
  });

  it("should mark unknown fields with null type and zero confidence", () => {
    const html = `<input type="text" name="xyz" />`;
    const fields = extractFormFields(html);

    expect(fields[0].extractedValueType).toBeNull();
    expect(fields[0].matchConfidence).toBe(0);
  });

  it("should set validated to false on all extracted fields", () => {
    const html = `<input type="text" name="name" placeholder="Full Name" />`;
    const fields = extractFormFields(html);

    expect(fields[0].validated).toBe(false);
  });

  it("should detect required attribute", () => {
    const html = `<input type="text" name="name" placeholder="Full Name" required />`;
    const fields = extractFormFields(html);

    expect(fields[0].required).toBe(true);
  });

  it("should extract multiple fields from a form", () => {
    const html = `
      <input type="text" name="name" placeholder="Full Name" />
      <input type="email" name="email" placeholder="Email" />
      <textarea name="cover" placeholder="Cover Letter"></textarea>
    `;
    const fields = extractFormFields(html);

    expect(fields).toHaveLength(3);
  });
});
