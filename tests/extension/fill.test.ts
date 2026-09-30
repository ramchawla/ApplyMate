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
  it("never matches inside another word (EEO misreports)", () => {
    expect(matchOption(["Hispanic or Latino", "Not Hispanic or Latino", "Decline"], "No")).toBe(1);
    expect(matchOption(["Woman (Female)", "Man (Male)"], "Male")).toBe(1);
    expect(matchOption(["Yes", "Maybe"], "Ye")).toBe(-1);
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

  it("checks a lone checkbox even when a same-named checkbox exists in a separate entry (real Workday)", async () => {
    const d = doc(`
      <div role="group"><h4>Work Experience 1</h4><input type="checkbox" name="currentlyWorkHere" id="cw1"><label for="cw1">I currently work here</label></div>
      <div role="group"><h4>Work Experience 2</h4><input type="checkbox" name="currentlyWorkHere" id="cw2"><label for="cw2">I currently work here</label></div>`);
    // Each entry is scanned and stamped on its own, as the Workday adapter does per entry.
    extractLiveFields(d.querySelectorAll("[role=group]")[0]);
    extractLiveFields(d.querySelectorAll("[role=group]")[1]);
    const [f1] = extractLiveFields(d.querySelectorAll("[role=group]")[0], { stamp: false });
    const res = await applyFill([{ fieldId: f1.id, value: "Yes" }], d);
    expect(res.missing).toEqual([]);
    expect((d.getElementById("cw1") as HTMLInputElement).checked).toBe(true);
    expect((d.getElementById("cw2") as HTMLInputElement).checked).toBe(false);
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
    const [rg] = extractLiveFields(d);
    const clicked: string[] = [];
    d.querySelectorAll("[role=radio]").forEach((r) =>
      r.addEventListener("click", () => clicked.push(r.textContent!)),
    );
    await applyFill([{ fieldId: rg.id, value: "No" }], d);
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

describe("combobox fill without timers", () => {
  it("picks an option as soon as the menu renders, even if timers never fire (hidden tab)", async () => {
    vi.useFakeTimers();
    try {
      const d = doc(`<label for="cb">Veteran Status</label><input id="cb" role="combobox"><div id="menu"></div><input type="hidden" id="val">`);
      const input = d.getElementById("cb") as HTMLInputElement;
      input.addEventListener("keydown", (e) => {
        if ((e as KeyboardEvent).key !== "ArrowDown") return;
        queueMicrotask(() => {
          for (const o of ["I am not a protected veteran", "I don't wish to answer"]) {
            const el = d.createElement("div");
            el.id = `react-select-cb-option-${o.length}`;
            el.textContent = o;
            el.addEventListener("click", () => ((d.getElementById("val") as HTMLInputElement).value = o));
            d.getElementById("menu")!.appendChild(el);
          }
        });
      });
      extractLiveFields(d);
      const res = await applyFill([{ fieldId: "cb", value: "Decline to self-identify" }], d);
      expect(res.filled).toEqual(["cb"]);
      expect((d.getElementById("val") as HTMLInputElement).value).toBe("I don't wish to answer");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("autocomplete text fields", () => {
  it("types the city and picks the suggestion (Lever location)", async () => {
    const d = doc(`<li class="application-question"><label><div class="application-label">Current location ✱</div>
      <div class="application-field"><input class="location-input" id="location-input" name="location" required>
      <input id="selected-location" type="hidden" name="selectedLocation">
      <div class="dropdown-container"><div class="dropdown-results"></div></div></div></label></li>`);
    const input = d.getElementById("location-input") as HTMLInputElement;
    // Real Lever searches on keydown (jQuery), reading the value afterwards.
    input.addEventListener("keydown", () => queueMicrotask(() => {
      if (!input.value) return;
      const results = d.querySelector(".dropdown-results")!;
      results.innerHTML = "";
      for (const [i, name] of ["Toronto, ON, CAN", "Toronto, OH, USA"].entries()) {
        const el = d.createElement("div");
        el.className = "dropdown-location";
        el.id = `location-${i}`;
        el.textContent = name;
        el.addEventListener("click", () => {
          (d.getElementById("selected-location") as HTMLInputElement).value = name;
          input.value = name;
        });
        results.appendChild(el);
      }
    }));
    const [f] = extractLiveFields(d);
    const res = await applyFill([{ fieldId: f.id, value: "Toronto, ON" }], d);
    expect(res.filled).toEqual([f.id]);
    expect((d.getElementById("selected-location") as HTMLInputElement).value).toBe("Toronto, ON, CAN");
  });

  it("keeps the typed value when no suggestions appear", async () => {
    const d = doc(`<div class="field"><label for="city">City</label><input id="city"><div class="autocomplete-list"></div></div>`);
    extractLiveFields(d);
    const res = await applyFill([{ fieldId: "city", value: "Toronto" }], d);
    expect(res.filled).toEqual(["city"]);
    expect((d.getElementById("city") as HTMLInputElement).value).toBe("Toronto");
  });
});

describe("button-group questions", () => {
  it("presses the matching yes/no button", async () => {
    const d = doc(`<div data-field-path="s"><label for="s">Will you require sponsorship?</label>
      <div><button aria-pressed="false">Yes</button><button aria-pressed="false">No</button></div></div>`);
    d.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => b.setAttribute("aria-pressed", "true")));
    const [f] = extractLiveFields(d);
    const res = await applyFill([{ fieldId: f.id, value: "No" }], d);
    expect(res.filled).toEqual([f.id]);
    expect(d.querySelectorAll("button")[1].getAttribute("aria-pressed")).toBe("true");
    expect(d.querySelectorAll("button")[0].getAttribute("aria-pressed")).toBe("false");
  });
});

describe("combobox open sequence", () => {
  it("opens widgets that only react to mouseup (Greenhouse's react-select wrapper)", async () => {
    const d = doc(`<label for="g">Gender</label><div class="wrap"><input id="g" role="combobox"></div><div id="menu"></div><input type="hidden" id="val">`);
    d.querySelector(".wrap")!.addEventListener("mouseup", () => {
      for (const o of ["Male", "Female", "Decline To Self Identify"]) {
        const el = d.createElement("div");
        el.id = `react-select-g-option-${o.length}`;
        el.textContent = o;
        el.addEventListener("click", () => ((d.getElementById("val") as HTMLInputElement).value = o));
        d.getElementById("menu")!.appendChild(el);
      }
    });
    extractLiveFields(d);
    const res = await applyFill([{ fieldId: "g", value: "Decline to self-identify" }], d);
    expect(res.filled).toEqual(["g"]);
    expect((d.getElementById("val") as HTMLInputElement).value).toBe("Decline To Self Identify");
  });
});

describe("combobox option scoping", () => {
  it("ignores another combobox's open listbox (aria-controls)", async () => {
    const d = doc(`
      <input id="iti" role="combobox" aria-expanded="true" aria-controls="iti-list">
      <ul id="iti-list" role="listbox"><li role="option">Decline to self-identify (wrong menu)</li></ul>
      <label for="g">Gender</label><input id="g" role="combobox"><div id="gmenu"></div><input type="hidden" id="val">`);
    const g = d.getElementById("g") as HTMLInputElement;
    g.addEventListener("keydown", () => {
      const el = d.createElement("div");
      el.setAttribute("role", "option");
      el.textContent = "Decline To Self Identify";
      el.addEventListener("click", () => ((d.getElementById("val") as HTMLInputElement).value = "ok"));
      d.getElementById("gmenu")!.appendChild(el);
    });
    const wrong = vi.fn();
    d.querySelector("#iti-list [role=option]")!.addEventListener("click", wrong);
    extractLiveFields(d);
    const res = await applyFill([{ fieldId: "g", value: "Decline to self-identify" }], d);
    expect(res.filled).toEqual(["g"]);
    expect(wrong).not.toHaveBeenCalled();
    expect((d.getElementById("val") as HTMLInputElement).value).toBe("ok");
  });

  it("uses react-select's per-input option ids", async () => {
    const d = doc(`
      <div id="react-select-other-option-0">No</div>
      <label for="auth">Authorized?</label><input id="auth" role="combobox"><div id="m"></div>`);
    const clicked: string[] = [];
    d.getElementById("react-select-other-option-0")!.addEventListener("click", () => clicked.push("other"));
    d.getElementById("auth")!.addEventListener("keydown", () => {
      const el = d.createElement("div");
      el.id = "react-select-auth-option-1";
      el.textContent = "No";
      el.addEventListener("click", () => clicked.push("auth"));
      d.getElementById("m")!.appendChild(el);
    });
    extractLiveFields(d);
    await applyFill([{ fieldId: "auth", value: "No" }], d);
    expect(clicked).toEqual(["auth"]);
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
