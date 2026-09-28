import { describe, it, expect } from "vitest";
import {
  extractLiveFields,
  inferValueType,
} from "../../packages/extension/src/content/extractors/form";

function doc(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
}

describe("extractLiveFields", () => {
  it("stamps controls with stable ids, reusing id/name and generating the rest", () => {
    const d = doc(
      `<input id="email" type="email"><input name="phone" type="tel"><input type="text" placeholder="City">`,
    );
    const ids = extractLiveFields(d).map((f) => f.id);
    expect(ids[0]).toBe("email");
    expect(ids[1]).toBe("phone");
    expect(ids[2]).toMatch(/^am-/);
    expect(d.querySelectorAll("[data-applymate-id]")).toHaveLength(3);
    expect(extractLiveFields(d).map((f) => f.id)).toEqual(ids);
  });

  it("can scan without touching the DOM (before a framework hydrates)", () => {
    const d = doc(`<label for="e">Email</label><input id="e" type="email"><input type="text">`);
    const fields = extractLiveFields(d, { stamp: false });
    expect(fields.map((f) => f.extractedValueType)).toEqual(["email", null]);
    expect(d.querySelectorAll("[data-applymate-id]")).toHaveLength(0);
  });

  it("skips hidden, submit and button inputs", () => {
    const d = doc(
      `<input type="hidden" name="h"><input type="submit"><input type="button"><input name="x">`,
    );
    expect(extractLiveFields(d).map((f) => f.id)).toEqual(["x"]);
  });

  it("resolves labels from for=, wrapping label, aria-labelledby, aria-label", () => {
    const d = doc(`
      <label for="a">First Name</label><input id="a">
      <label>Last Name <input id="b"></label>
      <span id="lc">Current Company</span><input id="c" aria-labelledby="lc">
      <input id="d" aria-label="LinkedIn Profile">`);
    expect(extractLiveFields(d).map((f) => [f.label, f.extractedValueType])).toEqual([
      ["First Name", "first-name"],
      ["Last Name", "last-name"],
      ["Current Company", "current-company"],
      ["LinkedIn Profile", "linkedin"],
    ]);
  });

  it("uses Lever-style sibling question text", () => {
    const d = doc(`
      <li class="application-question">
        <div class="application-label">Why do you want to join?</div>
        <div class="application-field"><textarea name="cards[0]"></textarea></div>
      </li>`);
    const [f] = extractLiveFields(d);
    expect(f.label).toBe("Why do you want to join?");
    expect(f.extractedValueType).toBe("custom-q");
  });

  it("collapses a radio group into one field with question and options", () => {
    const d = doc(`
      <fieldset><legend>Are you legally authorized to work in the United States? *</legend>
        <label><input type="radio" name="auth" value="1"> Yes</label>
        <label><input type="radio" name="auth" value="0"> No</label>
      </fieldset>`);
    const fields = extractLiveFields(d);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      id: "auth",
      type: "radio",
      label: "Are you legally authorized to work in the United States?",
      options: ["Yes", "No"],
      required: true,
      extractedValueType: "work-auth",
    });
  });

  it("lists select options without placeholders and reads aria-required", () => {
    const d = doc(`<label for="g">Gender</label>
      <select id="g" aria-required="true"><option value="">Select...</option><option>Male</option><option>Female</option><option>Decline to self-identify</option></select>`);
    const [f] = extractLiveFields(d);
    expect(f.options).toEqual(["Male", "Female", "Decline to self-identify"]);
    expect(f.required).toBe(true);
    expect(f.extractedValueType).toBe("gender");
  });

  it("skips aria-hidden validation inputs (Greenhouse requiredInput)", () => {
    const d = doc(`
      <div class="field-wrapper"><label id="q-label" for="q">Do you require visa sponsorship? <span aria-hidden="true">*</span></label>
        <input id="q" role="combobox" aria-labelledby="q-label" aria-required="true">
        <input required tabindex="-1" aria-hidden="true" class="requiredInput" value="">
      </div>
      <div class="question-description"><p>How do you pronounce your name?</p></div>`);
    const fields = extractLiveFields(d);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ id: "q", type: "combobox", extractedValueType: "sponsorship", required: true });
  });

  it("carries the question description for Claude", () => {
    const d = doc(`
      <label for="why">Why Anthropic?<span aria-hidden="true">*</span></label>
      <textarea id="why" aria-describedby="why-description why-error" aria-required="true"></textarea>
      <div id="why-description"><p>Why do you want to work here? Great answers are 200-400 words.</p></div>
      <div id="why-error"></div>`);
    expect(extractLiveFields(d)[0]).toMatchObject({
      label: "Why Anthropic?",
      description: "Why do you want to work here? Great answers are 200-400 words.",
    });
  });

  it("marks ARIA comboboxes", () => {
    const d = doc(`<label for="loc">Location (City)</label><input id="loc" role="combobox">`);
    expect(extractLiveFields(d)[0]).toMatchObject({
      type: "combobox",
      extractedValueType: "location",
    });
  });

  it("extracts non-native ARIA radiogroups", () => {
    const d = doc(`<div role="radiogroup" aria-label="Will you require sponsorship?">
      <div role="radio">Yes</div><div role="radio">No</div></div>`);
    expect(extractLiveFields(d)[0]).toMatchObject({
      type: "radio",
      options: ["Yes", "No"],
      extractedValueType: "sponsorship",
    });
  });
});

describe("inferValueType", () => {
  const t = (label: string, htmlType = "text", ac = "", type: any = "text") =>
    inferValueType(label.toLowerCase(), htmlType, ac, type).valueType;
  it("prefers autocomplete tokens", () => {
    expect(t("Field 1", "text", "given-name")).toBe("first-name");
    expect(t("x", "text", "section-a address-level2")).toBe("city");
  });
  it("classifies file inputs", () => {
    expect(t("Resume/CV", "file")).toBe("resume");
    expect(t("Cover Letter", "file")).toBe("cover-letter");
  });
  it("handles long question labels", () => {
    expect(
      t("Will you now or in the future require sponsorship for employment visa status (e.g., H-1B)?"),
    ).toBe("sponsorship");
    expect(
      t("Have you previously worked for this employer or any of its subsidiaries?"),
    ).toBe("custom-q");
    expect(
      t("Please describe your experience with open source software", "text", "", "textarea"),
    ).toBe("custom-q");
  });
  it("respects word boundaries and ordering", () => {
    expect(t("Location (City)")).toBe("location");
    expect(t("Company name")).toBe("current-company");
    expect(t("Personal statement")).toBeNull();
    expect(t("Email", "email")).toBe("email");
  });
});
