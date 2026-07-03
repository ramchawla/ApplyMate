import { describe, it, expect } from "vitest";
import { applyFillPlan } from "../../packages/extension/src/content/fill";
import type { FillInstruction } from "../../packages/extension/src/types";

function setupDom(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("applyFillPlan", () => {
  it("sets text input values by id", () => {
    const doc = setupDom(`<input id="n" type="text" />`);
    const ins: FillInstruction[] = [
      { fieldId: "n", valueType: "name", value: "Jane Dev", isFile: false },
    ];
    const result = applyFillPlan(ins, doc);
    expect((doc.getElementById("n") as HTMLInputElement).value).toBe("Jane Dev");
    expect(result.filled).toContain("n");
  });

  it("sets textarea values", () => {
    const doc = setupDom(`<textarea id="cl"></textarea>`);
    const ins: FillInstruction[] = [
      {
        fieldId: "cl",
        valueType: "cover-letter",
        value: "Dear Acme",
        isFile: false,
      },
    ];
    applyFillPlan(ins, doc);
    expect((doc.getElementById("cl") as HTMLTextAreaElement).value).toBe(
      "Dear Acme",
    );
  });

  it("dispatches input and change events", () => {
    const doc = setupDom(`<input id="n" type="text" />`);
    const el = doc.getElementById("n") as HTMLInputElement;
    const seen: string[] = [];
    el.addEventListener("input", () => seen.push("input"));
    el.addEventListener("change", () => seen.push("change"));
    applyFillPlan(
      [{ fieldId: "n", valueType: "name", value: "x", isFile: false }],
      doc,
    );
    expect(seen).toEqual(["input", "change"]);
  });

  it("finds fields by name when id is absent", () => {
    const doc = setupDom(`<input name="email" type="email" />`);
    applyFillPlan(
      [{ fieldId: "email", valueType: "email", value: "a@b.c", isFile: false }],
      doc,
    );
    expect(
      (doc.querySelector('[name="email"]') as HTMLInputElement).value,
    ).toBe("a@b.c");
  });

  it("selects a matching option by visible text", () => {
    const doc = setupDom(
      `<select id="auth">
         <option value="">Select...</option>
         <option value="yes_citizen">Yes, I am a US Citizen</option>
         <option value="no">No</option>
       </select>`,
    );
    const result = applyFillPlan(
      [
        {
          fieldId: "auth",
          valueType: "work-auth",
          value: "US Citizen",
          isFile: false,
        },
      ],
      doc,
    );
    expect((doc.getElementById("auth") as HTMLSelectElement).value).toBe(
      "yes_citizen",
    );
    expect(result.filled).toContain("auth");
  });

  it("reports a select with no matching option as missing", () => {
    const doc = setupDom(
      `<select id="s"><option value="a">Alpha</option></select>`,
    );
    const result = applyFillPlan(
      [{ fieldId: "s", valueType: "custom-q", value: "zzz", isFile: false }],
      doc,
    );
    expect(result.missing).toContain("s");
  });

  it("checks a checkbox for affirmative values", () => {
    const doc = setupDom(`<input id="cb" type="checkbox" />`);
    applyFillPlan(
      [{ fieldId: "cb", valueType: "work-auth", value: "Yes", isFile: false }],
      doc,
    );
    expect((doc.getElementById("cb") as HTMLInputElement).checked).toBe(true);
  });

  it("picks the right radio in a group by label text", () => {
    const doc = setupDom(
      `<label><input type="radio" name="visa" value="1" id="r1" />Yes, I need sponsorship</label>
       <label><input type="radio" name="visa" value="2" id="r2" />No sponsorship required</label>`,
    );
    applyFillPlan(
      [
        {
          fieldId: "visa",
          valueType: "work-auth",
          value: "No sponsorship",
          isFile: false,
        },
      ],
      doc,
    );
    expect((doc.getElementById("r2") as HTMLInputElement).checked).toBe(true);
    expect((doc.getElementById("r1") as HTMLInputElement).checked).toBe(false);
  });

  it("writes through an instance value property that shadows the native setter (controlled inputs)", () => {
    const doc = setupDom(`<input id="n" type="text" />`);
    const el = doc.getElementById("n") as HTMLInputElement;
    // Simulate a React-style value tracker: an instance property intercepting
    // plain `.value =` writes.
    let trackerSaw = "";
    const native = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(el),
      "value",
    )!;
    Object.defineProperty(el, "value", {
      configurable: true,
      get: () => native.get!.call(el),
      set: (v: string) => {
        trackerSaw = v;
      },
    });
    applyFillPlan(
      [{ fieldId: "n", valueType: "name", value: "Jane", isFile: false }],
      doc,
    );
    // The native setter was used, so the DOM value updated even though the
    // instance property would have swallowed a plain assignment.
    expect(native.get!.call(el)).toBe("Jane");
    expect(trackerSaw).toBe("");
  });

  it("outlines highlight fields in yellow", () => {
    const doc = setupDom(`<input id="mystery" type="text" />`);
    applyFillPlan([], doc, ["mystery"]);
    expect(
      (doc.getElementById("mystery") as HTMLInputElement).style.outline,
    ).toContain("#facc15");
  });

  it("reports missing fields and skips file instructions", () => {
    const doc = setupDom(`<input id="n" type="text" />`);
    const ins: FillInstruction[] = [
      { fieldId: "absent", valueType: "email", value: "x", isFile: false },
      { fieldId: "r", valueType: "resume", value: "", isFile: true },
    ];
    const result = applyFillPlan(ins, doc);
    expect(result.missing).toContain("absent");
    expect(result.filled).not.toContain("r");
  });
});
