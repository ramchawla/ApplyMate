import { describe, it, expect, vi } from "vitest";
import {
  applyFill,
  attachFile,
  matchOption,
  highlightEmptyRequired,
} from "../../packages/extension/src/content/fill";
import { extractLiveFields } from "../../packages/extension/src/content/extractors/form";

function doc(html: string): Document {
  const d = document.implementation.createHTMLDocument("t");
  d.body.innerHTML = html;
  return d;
}

describe("matchOption", () => {
  const opts = [
    "Yes, I am authorized",
    "No",
    "Not a protected veteran",
    "I don't wish to answer",
    "Canada",
  ];
  it.each([
    ["yes", 0],
    ["No", 1],
    ["Decline to self-identify", 3],
    ["Toronto, Ontario, Canada", 4],
    ["", -1],
    ["Purple", -1],
  ])("%s → %i", (wanted, idx) => {
    expect(matchOption(opts, wanted as string)).toBe(idx);
  });
  it("prefers exact over prefix", () => {
    expect(matchOption(["Not applicable", "No"], "no")).toBe(1);
  });
  it("matches the city head of a location against suggestions", () => {
    expect(matchOption(["Toronto, ON, Canada", "Torino, Italy"], "Toronto, Ontario")).toBe(0);
  });
});

describe("applyFill", () => {
  it("fills text, textarea, select, radio group, checkbox by applymate id", async () => {
    const d = doc(`
      <input id="n"><textarea id="t"></textarea>
      <select id="s"><option value="">Select</option><option value="y">Yes, I am</option><option value="n">No</option></select>
      <label><input type="radio" name="r" value="a">Yes</label><label><input type="radio" name="r" value="b">No</label>
      <input type="checkbox" id="c">`);
    extractLiveFields(d);
    const res = await applyFill(
      [
        { fieldId: "n", value: "Jane" },
        { fieldId: "t", value: "Long answer" },
        { fieldId: "s", value: "Yes" },
        { fieldId: "r", value: "No" },
        { fieldId: "c", value: "yes" },
      ],
      d,
    );
    expect(res.missing).toEqual([]);
    expect((d.getElementById("n") as HTMLInputElement).value).toBe("Jane");
    expect((d.getElementById("t") as HTMLTextAreaElement).value).toBe("Long answer");
    expect((d.getElementById("s") as HTMLSelectElement).value).toBe("y");
    expect((d.querySelector("input[value=b]") as HTMLInputElement).checked).toBe(true);
    expect((d.getElementById("c") as HTMLInputElement).checked).toBe(true);
  });

  it("reports missing fields and unmatched options", async () => {
    const d = doc(`<select id="s"><option>A</option></select>`);
    extractLiveFields(d);
    const res = await applyFill(
      [
        { fieldId: "s", value: "Z" },
        { fieldId: "ghost", value: "x" },
      ],
      d,
    );
    expect(res.missing).toEqual(["s", "ghost"]);
  });

  it("clicks the matching option in an ARIA radiogroup", async () => {
    const d = doc(
      `<div role="radiogroup" aria-label="Sponsor?"><div role="radio">Yes</div><div role="radio">No</div></div>`,
    );
    extractLiveFields(d);
    const clicked: string[] = [];
    d.querySelectorAll("[role=radio]").forEach((r) =>
      r.addEventListener("click", () => clicked.push(r.textContent!)),
    );
    await applyFill([{ fieldId: "am-0", value: "No" }], d);
    expect(clicked).toEqual(["No"]);
  });

  it("drives a react-select style combobox", async () => {
    const d = doc(
      `<label for="cb">Gender</label><div class="ctl"><input id="cb" role="combobox"></div><div id="menu"></div><input type="hidden" id="val">`,
    );
    const input = d.getElementById("cb") as HTMLInputElement;
    const menu = d.getElementById("menu")!;
    const render = (filter: string) => {
      menu.innerHTML = "";
      for (const o of ["Male", "Female", "I don't wish to answer"]) {
        if (filter && !o.toLowerCase().includes(filter.toLowerCase())) continue;
        const el = d.createElement("div");
        el.setAttribute("role", "option");
        el.textContent = o;
        el.addEventListener(
          "click",
          () => ((d.getElementById("val") as HTMLInputElement).value = o),
        );
        menu.appendChild(el);
      }
    };
    input.addEventListener(
      "keydown",
      (e) => (e as KeyboardEvent).key === "ArrowDown" && setTimeout(() => render(""), 20),
    );
    input.addEventListener("input", () => setTimeout(() => render(input.value), 20));
    extractLiveFields(d);
    const res = await applyFill([{ fieldId: "cb", value: "Decline to self-identify" }], d);
    expect(res.filled).toEqual(["cb"]);
    expect((d.getElementById("val") as HTMLInputElement).value).toBe("I don't wish to answer");
  });
});

describe("attachFile", () => {
  it("sets files through DataTransfer and fires change", () => {
    const d = doc(`<input type="file" id="f">`);
    const input = d.getElementById("f") as HTMLInputElement;
    let assigned: unknown = null;
    Object.defineProperty(input, "files", {
      set: (v) => (assigned = v),
      get: () => assigned,
      configurable: true,
    });
    class FakeDT {
      private list: File[] = [];
      items = { add: (f: File) => this.list.push(f) };
      get files() {
        return this.list;
      }
    }
    vi.stubGlobal("DataTransfer", FakeDT);
    const onChange = vi.fn();
    input.addEventListener("change", onChange);
    expect(attachFile(input, new File(["%PDF"], "r.pdf", { type: "application/pdf" }))).toBe(true);
    expect((assigned as File[])[0].name).toBe("r.pdf");
    expect(onChange).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("returns false when DataTransfer is unavailable", () => {
    const d = doc(`<input type="file" id="f">`);
    vi.stubGlobal("DataTransfer", undefined);
    expect(
      attachFile(d.getElementById("f") as HTMLInputElement, new File(["x"], "x.pdf")),
    ).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("highlightEmptyRequired", () => {
  it("outlines required fields still empty", () => {
    const d = doc(`<input id="a" required><input id="b" required value="x"><input id="c">`);
    const fields = extractLiveFields(d);
    expect(highlightEmptyRequired(d, fields)).toEqual(["a"]);
    expect((d.getElementById("a") as HTMLElement).style.outline).toContain("solid");
  });
});
