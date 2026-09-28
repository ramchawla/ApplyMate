import { describe, it, expect } from "vitest";
import { extractLiveFields } from "../../packages/extension/src/content/extractors/form";
import { applyFill, highlightEmptyRequired } from "../../packages/extension/src/content/fill";

function page(html: string): Document {
  const d = document.implementation.createHTMLDocument("t");
  d.body.innerHTML = html;
  return d;
}

function listbox(d: Document, items: string[], onPick: (t: string) => void, attrs = "") {
  const ul = d.createElement("ul");
  ul.setAttribute("role", "listbox");
  if (attrs) ul.id = attrs;
  for (const t of items) {
    const li = d.createElement("li");
    li.setAttribute("role", "option");
    li.innerHTML = `<div>${t}</div>`;
    li.addEventListener("click", () => onPick(t));
    ul.appendChild(li);
  }
  d.body.appendChild(ul);
}

describe("dropdown buttons (Workday)", () => {
  it("extracts and fills a listbox button", async () => {
    const d = page(`<label for="country--country">Country*</label>
      <button id="country--country" aria-haspopup="listbox" aria-expanded="false">Select One</button>`);
    const btn = d.getElementById("country--country")!;
    btn.addEventListener("click", () => listbox(d, ["Canada", "United States of America"], (t) => (btn.textContent = t)));
    const fields = extractLiveFields(d);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ type: "combobox", label: "Country", required: true, extractedValueType: "country" });
    expect(highlightEmptyRequired(d, fields)).toEqual([fields[0].id]);
    const res = await applyFill([{ fieldId: fields[0].id, value: "Canada" }], d);
    expect(res.filled).toEqual([fields[0].id]);
    expect(btn.textContent).toBe("Canada");
  });

  it("drops the button's own placeholder text from an aria-labelledby label", () => {
    const d = page(`<div id="lbl">Phone Device Type</div>
      <button id="b" aria-haspopup="listbox" aria-labelledby="lbl b">Select One</button>`);
    expect(extractLiveFields(d)[0].label).toBe("Phone Device Type");
  });
});

describe("search prompts (Workday)", () => {
  it("opens a matching category and picks from its sub-list", async () => {
    const d = page(`<div data-automation-id="formField-src"><label for="src">How Did You Hear About Us?*</label>
      <div data-automation-id="multiSelectContainer"><ul id="picked"></ul>
      <div data-automation-id="multiselectInputContainer"><input id="src" data-automation-id="searchBox"></div></div></div>
      <div id="menu"></div>`);
    const menu = d.getElementById("menu")!;
    const show = (items: string[], onPick: (t: string) => void) => {
      menu.innerHTML = "";
      for (const t of items) {
        const o = d.createElement("div");
        o.setAttribute("data-automation-id", "promptOption");
        o.textContent = t;
        o.addEventListener("click", () => onPick(t));
        menu.appendChild(o);
      }
    };
    const choose = (t: string) => {
      menu.innerHTML = "";
      d.getElementById("picked")!.innerHTML = `<li data-automation-id="selectedItem">${t}</li>`;
    };
    d.getElementById("src")!.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key !== "Enter") return;
      // "Job Board" is a category: pressing it swaps in its leaves.
      show(["Job Board", "Referral"], (t) => (t === "Job Board" ? setTimeout(() => show(["Indeed", "Other Job Board"], choose), 50) : choose(t)));
    });
    const [f] = extractLiveFields(d);
    const res = await applyFill([{ fieldId: f.id, value: "Job Board" }], d);
    expect(d.getElementById("picked")!.textContent).toBe("Other Job Board");
    expect(res.filled).toEqual([f.id]);
  });

  it("types, presses Enter and picks the matching prompt option", async () => {
    const d = page(`<label for="src">How Did You Hear About Us?*</label>
      <div data-automation-id="multiselectInputContainer"><input id="src" data-automation-id="searchBox"></div>
      <div id="menu"></div><span id="chosen"></span>`);
    const input = d.getElementById("src") as HTMLInputElement;
    input.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key !== "Enter") return;
      for (const t of ["LinkedIn", "LinkedIn Learning"]) {
        const o = d.createElement("div");
        o.setAttribute("data-automation-id", "promptOption");
        o.textContent = t;
        o.addEventListener("click", () => (d.getElementById("chosen")!.textContent = t));
        d.getElementById("menu")!.appendChild(o);
      }
    });
    const [f] = extractLiveFields(d);
    expect(f).toMatchObject({ type: "combobox", extractedValueType: "how-heard" });
    const res = await applyFill([{ fieldId: f.id, value: "LinkedIn" }], d);
    expect(res.filled).toEqual([f.id]);
    expect(d.getElementById("chosen")!.textContent).toBe("LinkedIn");
  });
});
