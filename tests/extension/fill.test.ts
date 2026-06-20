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
