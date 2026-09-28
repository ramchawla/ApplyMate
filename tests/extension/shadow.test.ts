import { describe, it, expect } from "vitest";
import { extractLiveFields } from "../../packages/extension/src/content/extractors/form";
import { applyFill } from "../../packages/extension/src/content/fill";
import { deepQueryAll } from "../../packages/extension/src/content/dom";

function page(html = ""): Document {
  const d = document.implementation.createHTMLDocument("t");
  d.body.innerHTML = html;
  return d;
}

describe("shadow DOM", () => {
  it("finds, labels and fills fields inside open shadow roots", async () => {
    const d = page(`<div id="host"></div>`);
    const root = d.getElementById("host")!.attachShadow({ mode: "open" });
    root.innerHTML = `<label for="fn">First Name</label><input id="fn">
      <label for="em">Email</label><input id="em" type="email">`;
    const fields = extractLiveFields(d);
    expect(fields.map((f) => [f.label, f.extractedValueType])).toEqual([
      ["First Name", "first-name"],
      ["Email", "email"],
    ]);
    const res = await applyFill([{ fieldId: fields[0].id, value: "Ram" }], d);
    expect(res.filled).toEqual([fields[0].id]);
    expect((root.getElementById("fn") as HTMLInputElement).value).toBe("Ram");
  });

  it("deepQueryAll descends into nested shadow roots", () => {
    const d = page(`<div id="a"></div>`);
    const r1 = d.getElementById("a")!.attachShadow({ mode: "open" });
    r1.innerHTML = `<input name="x"><div id="b"></div>`;
    const r2 = (r1.getElementById("b") as HTMLElement).attachShadow({ mode: "open" });
    r2.innerHTML = `<input name="y">`;
    expect(deepQueryAll(d, "input").map((i) => i.getAttribute("name"))).toEqual(["x", "y"]);
  });
});

describe("scoped scans", () => {
  it("only returns fields inside the given container", () => {
    const d = page(`<input name="outside"><section id="s"><label for="t">Job Title</label><input id="t"></section>`);
    expect(extractLiveFields(d.getElementById("s")!).map((f) => f.id)).toEqual(["t"]);
  });

  it("never reuses an anonymous id across scans of different subtrees", () => {
    const d = page(`<section id="a"><input></section><section id="b"><input></section>`);
    const a = extractLiveFields(d.getElementById("a")!);
    const b = extractLiveFields(d.getElementById("b")!);
    expect(a[0].id).not.toBe(b[0].id);
    expect(d.querySelectorAll(`[data-applymate-id="${a[0].id}"]`)).toHaveLength(1);
  });
});
