import { describe, it, expect, vi, afterEach } from "vitest";
import {
  isWorkday,
  fillWorkdaySections,
  fillWorkdayDates,
} from "../../packages/extension/src/content/adapters/workday";
import { runOneClick } from "../../packages/extension/src/content/content";
import { extractLiveFields } from "../../packages/extension/src/content/extractors/form";
import { applyFill, highlightEmptyRequired } from "../../packages/extension/src/content/fill";
import { normalizeProfile } from "../../packages/extension/src/utils/profile";

const dateGroup = (aid: string, label: string, month = true) => `
  <div data-automation-id="formField-${aid}"><label>${label}</label>
    ${month ? `<input data-automation-id="dateSectionMonth-input" role="spinbutton" aria-label="Month">` : ""}
    <input data-automation-id="dateSectionYear-input" role="spinbutton" aria-label="Year"></div>`;

const WORK_ENTRY = (n: number) => `
  <h4>Work Experience ${n}</h4><button>Delete</button>
  <label for="w${n}-title">Job Title*</label><input id="w${n}-title" required>
  <label for="w${n}-company">Company*</label><input id="w${n}-company">
  <label for="w${n}-loc">Location</label><input id="w${n}-loc">
  <input type="checkbox" id="w${n}-cur"><label for="w${n}-cur">I currently work here</label>
  ${dateGroup("startDate", "From*")}${dateGroup("endDate", "To*")}
  <label for="w${n}-desc">Role Description</label><textarea id="w${n}-desc"></textarea>`;
const EDU_ENTRY = (n: number) => `
  <h4>Education ${n}</h4>
  <label for="e${n}-school">School or University*</label><input id="e${n}-school">
  <label for="e${n}-degree">Degree*</label><input id="e${n}-degree">
  <label for="e${n}-major">Field of Study</label><input id="e${n}-major">
  <label for="e${n}-gpa">Overall Result (GPA)</label><input id="e${n}-gpa">
  ${dateGroup("firstYearAttended", "From", false)}${dateGroup("lastYearAttended", "To", false)}`;

// Workday "My Experience": each section's Add button appends an entry.
function myExperience(extra = "") {
  const d = document.implementation.createHTMLDocument("t");
  d.body.innerHTML = `<h2>My Experience</h2>
    <div data-automation-id="workExperienceSection"><h3>Work Experience</h3>
      <button data-automation-id="add-button" aria-label="Add Work Experience">Add</button></div>
    <div data-automation-id="educationSection"><h3>Education</h3>
      <button data-automation-id="add-button" aria-label="Add Education">Add</button></div>
    ${extra}
    <button data-automation-id="pageFooterNextButton">Save and Continue</button>`;
  const adds = { work: 0, edu: 0 };
  for (const [section, key, entry] of [
    ["workExperienceSection", "work", WORK_ENTRY],
    ["educationSection", "edu", EDU_ENTRY],
  ] as const) {
    const box = d.querySelector(`[data-automation-id=${section}]`)!;
    const add = box.querySelector("button")!;
    add.addEventListener("click", () => {
      const n = ++adds[key];
      const div = d.createElement("div");
      div.setAttribute("role", "group");
      div.innerHTML = entry(n);
      box.insertBefore(div, add);
      add.textContent = "Add Another";
    });
  }
  return { d, adds };
}

const profile = normalizeProfile({
  name: { first: "Jane", last: "Dev" },
  email: "j@x.com",
  current: { title: "Staff Engineer" },
  work: [
    { company: "RBC", title: "Senior Software Engineer", location: "Toronto, ON", start: "2026-05", current: true, description: "Platform work." },
    { company: "RBC", title: "Software Engineer", location: "Toronto, ON", start: "2024-06", end: "2026-04", description: "CI/CD." },
  ],
  education: [{ school: "University of Toronto", degree: "BSc", major: "Computer Science", start: "2020", end: "2024" }],
});
const val = (d: Document, id: string) => (d.getElementById(id) as HTMLInputElement).value;
const dates = (d: Document, entry: number) =>
  Array.from(d.querySelectorAll<HTMLInputElement>("[role=group]")[entry].querySelectorAll("[data-automation-id^=dateSection]")).map((i) => i.value);

describe("Workday adapter", () => {
  it("detects Workday by host or automation-id markup", () => {
    expect(isWorkday(myExperience().d)).toBe(true);
    const plain = document.implementation.createHTMLDocument("t");
    plain.body.innerHTML = `<input id="a">`;
    expect(isWorkday(plain)).toBe(false);
  });

  it("adds one entry per profile item and fills them by label, dates via spinners", async () => {
    const { d, adds } = myExperience();
    const res = await fillWorkdaySections(d, profile, () => false);
    expect(adds).toEqual({ work: 2, edu: 1 });
    expect(res.added).toBe(3);
    expect(val(d, "w1-title")).toBe("Senior Software Engineer");
    expect(val(d, "w1-company")).toBe("RBC");
    expect(val(d, "w1-loc")).toBe("Toronto, ON");
    expect((d.getElementById("w1-cur") as HTMLInputElement).checked).toBe(true);
    expect((d.getElementById("w2-cur") as HTMLInputElement).checked).toBe(false);
    expect(val(d, "w2-title")).toBe("Software Engineer");
    expect(val(d, "w2-desc")).toBe("CI/CD.");
    expect(dates(d, 0)).toEqual(["05", "2026", "", ""]);
    expect(dates(d, 1)).toEqual(["06", "2024", "04", "2026"]);
    expect(val(d, "e1-school")).toBe("University of Toronto");
    expect(val(d, "e1-major")).toBe("Computer Science");
    expect(dates(d, 2)).toEqual(["2020", "2024"]);
    // Every entry field belongs to the adapter (instant fill must skip them).
    expect(res.owned).toContain("w2-title");
  });

  it("re-running adds nothing and keeps what the user changed", async () => {
    const { d, adds } = myExperience();
    await fillWorkdaySections(d, profile, () => false);
    (d.getElementById("w1-title") as HTMLInputElement).value = "My Title";
    (d.getElementById("w2-company") as HTMLInputElement).value = "";
    const res = await fillWorkdaySections(d, profile, (id) => id === "w2-company");
    expect(adds).toEqual({ work: 2, edu: 1 });
    expect(res.added).toBe(0);
    expect(val(d, "w1-title")).toBe("My Title");
    expect(val(d, "w2-company")).toBe("");
  });

  it("only markup Workday actually uses counts as Workday", () => {
    const d = document.implementation.createHTMLDocument("t");
    d.body.innerHTML = `<div data-automation-id="hero"><h3>Education</h3><button>Add</button></div>`;
    expect(isWorkday(d)).toBe(false);
  });

  it("never presses another section's Add button", async () => {
    const d = document.implementation.createHTMLDocument("t");
    d.body.innerHTML = `<div data-automation-id="applyFlowPage">
      <div><h3>Work Experience</h3><p>Upload a resume to add experience.</p></div>
      <div id="edu"><h3>Education</h3><button data-automation-id="add-button">Add</button></div></div>`;
    let eduAdds = 0;
    d.querySelector("#edu button")!.addEventListener("click", () => {
      eduAdds++;
      d.getElementById("edu")!.insertAdjacentHTML("afterbegin", `<div role="group">${EDU_ENTRY(eduAdds)}</div>`);
    });
    await fillWorkdaySections(d, { ...profile, education: [] }, () => false);
    expect(eduAdds).toBe(0); // no schools; the two jobs never press Education's Add
  });

  it("adds nothing to a section whose entries it can't recognise", async () => {
    const { d, adds } = myExperience();
    const box = d.querySelector("[data-automation-id=workExperienceSection]")!;
    box.insertAdjacentHTML("afterbegin", `<div role="group"><h4>Job 1</h4><label for="x">Job Title</label><input id="x" value="Mine"></div>`);
    await fillWorkdaySections(d, profile, () => false);
    expect(adds.work).toBe(0);
  });

  it("never crashes on a real Workday date group's decorative display div", async () => {
    const d = myExperience().d;
    const box = d.querySelector("[data-automation-id=workExperienceSection]")!;
    box.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const entry = d.querySelector("[role=group]")!;
    // Real Workday: a non-input "-display" div sits beside each "-input".
    for (const aid of ["dateSectionMonth", "dateSectionYear"]) {
      entry.querySelector(`[data-automation-id="${aid}-input"]`)!.insertAdjacentHTML(
        "beforebegin",
        `<div data-automation-id="${aid}-display">--</div>`,
      );
    }
    await expect(fillWorkdaySections(d, profile, () => false)).resolves.not.toThrow();
    expect(val(d, "w1-title")).toBe("Senior Software Engineer");
  });

  it("ignores the display div beside a real Workday date input", () => {
    const d = document.implementation.createHTMLDocument("t");
    d.body.innerHTML = `<div data-automation-id="formField-startDate"><label>From*</label>
        <div data-automation-id="dateSectionMonth-display">MM</div>
        <input data-automation-id="dateSectionMonth-input">
        <div data-automation-id="dateSectionYear-display">YYYY</div>
        <input data-automation-id="dateSectionYear-input"></div>`;
    expect(() => fillWorkdayDates(d)).not.toThrow();
    const box = d.querySelector("[data-automation-id=formField-startDate]")!;
    expect(box.querySelector("[data-automation-id=dateSectionMonth-display]")!.textContent).toBe("MM");
  });

  it("fills a self-identify Date spinner group with today, leaving other dates alone", () => {
    const d = document.implementation.createHTMLDocument("t");
    d.body.innerHTML = `<div data-automation-id="formField-dateSignedOn"><label>Date*</label>
        <input data-automation-id="dateSectionMonth-input"><input data-automation-id="dateSectionDay-input">
        <input data-automation-id="dateSectionYear-input"></div>
      ${dateGroup("availableDate", "When can you start?")}`;
    d.body.insertAdjacentHTML("beforeend", dateGroup("dob", "Date of Birth") + dateGroup("avail", "Date Available"));
    fillWorkdayDates(d, new Date(2026, 8, 7));
    expect(Array.from(d.querySelectorAll("input")).map((i) => i.value)).toEqual(["09", "07", "2026", "", "", "", "", "", ""]);
  });

  it("the wizard gives entry fields to the adapter, not the instant fill", async () => {
    const { d } = myExperience(`<label for="res">Resume</label><input type="file" id="res">`);
    const report = await runOneClick({
      doc: d, fields: extractLiveFields(d), keywords: [], pollMs: 1, settleMs: 1, stepTimeoutMs: 300,
      tailorJobId: "T0",
      jd: { url: "u", title: "", company: "", description: "" }, jdSource: "none",
      send: async (m: any) => (m.type === "GET_PROFILE" ? profile : { error: "offline" }),
      onStatus: () => {},
    });
    // "Job Title" maps to current-title in the profile; entries must keep their own.
    expect(val(d, "w1-title")).toBe("Senior Software Engineer");
    expect(val(d, "w2-title")).toBe("Software Engineer");
    expect(report.filled).toBeGreaterThan(10);
  });
});

describe("Workday adapter — slow, network-backed real Workday", () => {
  afterEach(() => vi.useRealTimers());

  it("waits long enough for a slow Add response before giving up", async () => {
    vi.useFakeTimers();
    const d = document.implementation.createHTMLDocument("t");
    d.body.innerHTML = `<div role="group"><h4>Work Experience</h4><button data-automation-id="add-button">Add</button></div>`;
    const box = d.querySelector("[role=group]")!;
    box.querySelector("button")!.addEventListener("click", () => {
      // Real Workday: a network round trip before the entry renders.
      setTimeout(() => {
        const entry = d.createElement("div");
        entry.setAttribute("role", "group");
        entry.innerHTML = `<h4>Work Experience 1</h4><label for="t">Job Title</label><input id="t">`;
        box.insertBefore(entry, box.querySelector("button"));
      }, 6000);
    });
    const onlyWork = { ...profile, work: [profile.work[0]], education: [] };
    const promise = fillWorkdaySections(d, onlyWork, () => false);
    await vi.advanceTimersByTimeAsync(7000);
    const res = await promise;
    expect(res.added).toBe(1);
    expect(val(d, "t")).toBe("Senior Software Engineer");
  });

  it("waits for an entry's fields to render before giving up on filling it", async () => {
    vi.useFakeTimers();
    const d = document.implementation.createHTMLDocument("t");
    d.body.innerHTML = `<div role="group"><h4>Education</h4><button data-automation-id="add-button">Add</button></div>`;
    const box = d.querySelector("[role=group]")!;
    const addBtn = box.querySelector("button")!;
    addBtn.addEventListener("click", () => {
      // The heading commits first; the entry's own inputs render a beat later.
      const entry = d.createElement("div");
      entry.setAttribute("role", "group");
      entry.innerHTML = `<h4>Education 1</h4>`;
      box.insertBefore(entry, addBtn);
      setTimeout(() => {
        entry.insertAdjacentHTML("beforeend", `<label for="sch">School or University</label><input id="sch">`);
      }, 800);
    });
    const oneSchool = { ...profile, work: [], education: [{ school: "Test U", degree: "", major: "", gpa: "", start: "", end: "" }] };
    const promise = fillWorkdaySections(d, oneSchool, () => false);
    await vi.advanceTimersByTimeAsync(2000);
    await promise;
    expect(val(d, "sch")).toBe("Test U");
  });
});

describe("Workday prompts", () => {
  const prompt = (selected: string) => {
    const d = document.implementation.createHTMLDocument("t");
    d.body.innerHTML = `<div data-automation-id="formField-source"><label for="src">How Did You Hear About Us?*</label>
      <div data-automation-id="multiSelectContainer"><ul>${selected}</ul>
      <div data-automation-id="multiselectInputContainer"><input id="src" data-automation-id="searchBox" required></div></div></div>`;
    return d;
  };
  it("counts a selected pill as filled and never re-picks it", async () => {
    const d = prompt(`<li data-automation-id="selectedItem">LinkedIn</li>`);
    const [f] = extractLiveFields(d);
    expect(highlightEmptyRequired(d, [f])).toEqual([]);
    let typed = false;
    d.getElementById("src")!.addEventListener("keydown", () => (typed = true));
    expect((await applyFill([{ fieldId: f.id, value: "LinkedIn" }], d)).filled).toEqual([f.id]);
    expect(typed).toBe(false);
    const empty = prompt("");
    expect(highlightEmptyRequired(empty, extractLiveFields(empty))).toHaveLength(1);
  });
});
