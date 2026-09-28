import { describe, it, expect } from "vitest";
import {
  buildInstantPlan,
  profileValue,
  ruleAnswer,
} from "../../packages/extension/src/lib/field-mapping";
import { normalizeProfile } from "../../packages/extension/src/utils/profile";
import type { FormField } from "../../packages/extension/src/types";

const profile = normalizeProfile({
  name: { first: "Jane", last: "Dev" },
  email: "jane@example.com",
  address: { city: "Toronto", state: "ON" },
  links: { linkedin: "https://linkedin.com/in/jane" },
  work_auth: { authorized: "Yes", sponsorship: "No" },
  eeo: { gender: "Decline to self-identify" },
  answers: [
    { match: "how did you (hear|find)", answer: "LinkedIn" },
    { match: "([bad", answer: "Literal" },
  ],
});

const field = (
  label: string,
  extractedValueType: string | null,
  type: FormField["type"] = "text",
): FormField => ({
  id: label,
  label,
  type,
  required: false,
  extractedValueType,
  matchConfidence: 0.8,
  validated: false,
});

describe("normalizeProfile", () => {
  it("fills missing keys with empty strings and drops bad rules", () => {
    const p = normalizeProfile({ name: "oops", answers: [{ answer: "x" }, null] });
    expect(p.name).toEqual({ first: "", last: "", preferred: "" });
    expect(p.answers).toEqual([]);
    expect(p.eeo.veteran).toBe("");
  });
});

describe("profileValue", () => {
  it("maps value types to profile fields", () => {
    expect(profileValue(field("First Name", "first-name"), profile)).toBe("Jane");
    expect(profileValue(field("Name", "name"), profile)).toBe("Jane Dev");
    expect(profileValue(field("Preferred", "preferred-name"), profile)).toBe("Jane");
    expect(profileValue(field("Location", "location"), profile)).toBe("Toronto, ON");
    expect(profileValue(field("Sponsorship?", "sponsorship"), profile)).toBe("No");
    expect(profileValue(field("Gender", "gender"), profile)).toBe("Decline to self-identify");
  });
  it("returns null for empty profile values and unknown types", () => {
    expect(profileValue(field("Phone", "phone"), profile)).toBeNull();
    expect(profileValue(field("Favorite color", null), profile)).toBeNull();
  });
  it("lets answer rules win, falling back to substring for invalid regex", () => {
    expect(ruleAnswer("How did you hear about us?", profile.answers)).toBe("LinkedIn");
    expect(ruleAnswer("Pick ([bad option", profile.answers)).toBe("Literal");
    expect(profileValue(field("How did you find this job?", "how-heard"), profile)).toBe(
      "LinkedIn",
    );
  });
});

describe("buildInstantPlan", () => {
  it("splits fields into instant values and pending questions, skipping files", () => {
    const plan = buildInstantPlan(
      [
        field("Email", "email"),
        field("Why us?", "custom-q", "textarea"),
        field("Resume", "resume", "file"),
        field("Phone", "phone"),
      ],
      profile,
    );
    expect(plan.instructions).toEqual([{ fieldId: "Email", value: "jane@example.com" }]);
    expect(plan.pending.map((f) => f.id)).toEqual(["Why us?", "Phone"]);
  });
});
