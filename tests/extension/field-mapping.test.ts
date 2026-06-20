import { describe, it, expect } from "vitest";
import { buildFillPlan } from "../../packages/extension/src/lib/field-mapping";
import type { FormField, Profile } from "../../packages/extension/src/types";

const profile: Profile = {
  fullName: "Jane Dev",
  email: "jane@example.com",
  phone: "555-1234",
  linkedin: "linkedin.com/in/jane",
  github: "github.com/jane",
  website: "jane.dev",
};

function field(partial: Partial<FormField>): FormField {
  return {
    id: "f",
    label: "",
    type: "text",
    required: false,
    matchConfidence: 1,
    validated: true,
    ...partial,
  };
}

const output = {
  coverLetter: "Dear Acme...",
  formFieldGuidance: [
    { fieldId: "whyq", suggestedAnswer: "I love systems.", relatedBullets: [] },
  ],
} as any;

describe("buildFillPlan", () => {
  it("maps name and email from profile", () => {
    const plan = buildFillPlan(
      [
        field({ id: "n", extractedValueType: "name" }),
        field({ id: "e", extractedValueType: "email" }),
      ],
      profile,
      output,
    );
    expect(plan.instructions).toContainEqual(
      expect.objectContaining({
        fieldId: "n",
        value: "Jane Dev",
        isFile: false,
      }),
    );
    expect(plan.instructions).toContainEqual(
      expect.objectContaining({ fieldId: "e", value: "jane@example.com" }),
    );
  });

  it("maps cover letter", () => {
    const plan = buildFillPlan(
      [field({ id: "cl", extractedValueType: "cover-letter" })],
      profile,
      output,
    );
    expect(plan.instructions[0].value).toBe("Dear Acme...");
  });

  it("maps a custom question by field id", () => {
    const plan = buildFillPlan(
      [field({ id: "whyq", extractedValueType: "custom-q" })],
      profile,
      output,
    );
    expect(plan.instructions[0].value).toBe("I love systems.");
  });

  it("marks resume fields as file instructions with empty value", () => {
    const plan = buildFillPlan(
      [field({ id: "r", type: "file", extractedValueType: "resume" })],
      profile,
      output,
    );
    expect(plan.instructions[0].isFile).toBe(true);
    expect(plan.instructions[0].value).toBe("");
  });

  it("collects unmapped fields", () => {
    const plan = buildFillPlan(
      [field({ id: "weird", extractedValueType: null })],
      profile,
      output,
    );
    expect(plan.unmappedFieldIds).toContain("weird");
    expect(plan.instructions).toHaveLength(0);
  });

  it("uses user override value type when present", () => {
    const plan = buildFillPlan(
      [
        field({
          id: "x",
          extractedValueType: null,
          userSelectedValueType: "email",
        }),
      ],
      profile,
      output,
    );
    expect(plan.instructions[0].value).toBe("jane@example.com");
  });
});
