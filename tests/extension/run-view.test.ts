import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Diff } from "../../packages/extension/src/ui/components/Diff";
import { buildRunView, nameIds } from "../../lib/shared/run-view";
import { latexToMarked } from "../../lib/shared/latex-text";
import type { RunFile, RunState } from "../../lib/shared/types";

const master = {
  summary: "Backend engineer.",
  "r0.b0": "Built a \\textbf{Rust} service.",
  "r0.b1": "Cut CI time by 40\\%.",
  "skills.languages": "Python, Go",
};

const report = (over: Partial<RunFile> = {}): RunFile => ({
  applicationId: "app_1",
  runId: "run-1",
  createdAt: "2026-11-16T10:00:00.000Z",
  job: { title: "SRE", company: "Acme", url: "https://x/1" },
  fileName: "Jane_Dev_Acme_SRE.pdf",
  wantCoverLetterPdf: false,
  labels: { summary: "Summary", "r0.b0": "Acme Corp · bullet 1", "skills.languages": "Skills · Languages" },
  questions: [{ fieldId: "q1", label: "Why Acme?", type: "textarea", required: true }],
  keywords: {
    present: [{ keyword: "Python", where: "skills.languages" }],
    injected: [
      { keyword: "Kubernetes", where: "r0.b0" },
      { keyword: "SLOs", where: "the summary and two bullets" },
    ],
    skipped: [{ keyword: "rust", reason: "not in corpus" }],
  },
  edits: [
    { id: "r0.b0", before: master["r0.b0"], after: "Built a \\textbf{Kubernetes} service." },
    { id: "r0.b1", before: master["r0.b1"], after: "Cut CI time by 40\\% fast.", reverted: "reverted to keep the resume on one page" },
  ],
  warnings: ["r0.b0: seniority wording inflated", "Resume is longer than your master"],
  pages: 1,
  ...over,
});

const state = (over: Partial<RunState> = {}): RunState => ({
  edits: { "r0.b0": "Built a \\textbf{Kubernetes} service." },
  order: {},
  coverLetter: "Dear Acme,",
  answers: { q1: "Reliability." },
  questions: [{ fieldId: "q1", label: "Why Acme?", type: "textarea", required: true }],
  version: 0,
  ...over,
});

describe("buildRunView", () => {
  it("counts coverage as present + injected over all keywords", () => {
    const v = buildRunView(report(), state(), master);
    expect(v.coverage).toEqual({ covered: 3, total: 4 });
    expect(v.keywords.map((k) => k.status)).toEqual(["injected", "injected", "present", "skipped"]);
    expect(v).toMatchObject({ title: "SRE", company: "Acme", version: 0, pages: 1, letter: "Dear Acme," });
  });

  it("keyword where is the part's label", () => {
    const v = buildRunView(report(), state(), master);
    expect(v.keywords.find((k) => k.keyword === "Kubernetes")?.where).toBe("Acme Corp · bullet 1");
    expect(v.keywords.find((k) => k.keyword === "Python")?.where).toBe("Skills · Languages");
    expect(v.keywords.find((k) => k.keyword === "rust")).toMatchObject({ status: "skipped", reason: "not in corpus" });
  });

  it("an id with no label (or free text) shows as Resume, never the raw id", () => {
    const v = buildRunView(
      report({ keywords: { present: [{ keyword: "Go", where: "r9.b9" }], injected: [], skipped: [] } }),
      state({ edits: { "r9.b9": "New." } }),
      { ...master, "r9.b9": "Old." },
    );
    expect(v.keywords[0].where).toBe("Resume");
    expect(v.changes.find((c) => c.id === "r9.b9")?.label).toBe("Resume");
    const free = buildRunView(report(), state(), master);
    expect(free.keywords.find((k) => k.keyword === "SLOs")?.where).toBe("Resume");
    expect(free.warnings[0]).toBe("Acme Corp · bullet 1: seniority wording inflated");
  });

  it("a chat-applied summary shows in changes with before = master text", () => {
    const v = buildRunView(report(), state({ edits: { ...state().edits, summary: "SRE who ships." } }), master);
    expect(v.changes.find((c) => c.id === "summary")).toEqual({
      id: "summary",
      label: "Summary",
      before: "Backend engineer.",
      after: "SRE who ships.",
    });
  });

  it("keeps reverted edits with their reason, omits unchanged parts", () => {
    const v = buildRunView(report(), state(), master);
    expect(v.changes.find((c) => c.id === "r0.b1")).toEqual({
      id: "r0.b1",
      label: "Resume",
      before: master["r0.b1"],
      after: master["r0.b1"],
      reverted: "reverted to keep the resume on one page",
      attempted: "Cut CI time by 40\\% fast.",
    });
    // Chat undo put the tailoring edit back to master: no change left to show.
    const undone = buildRunView(report(), state({ edits: { "r0.b0": master["r0.b0"] } }), master);
    expect(undone.changes.map((c) => c.id)).toEqual(["r0.b1"]);
  });

  it("answers use question labels", () => {
    const v = buildRunView(
      report(),
      state({
        questions: [...state().questions, { fieldId: "q2", label: "Salary?", type: "text", required: false }],
      }),
      master,
    );
    expect(v.answers).toEqual([
      { label: "Why Acme?", value: "Reliability." },
      { label: "Salary?", value: "" },
    ]);
  });
});

describe("buildRunView: reorders, order, warnings", () => {
  const m = { summary: "S.", "r0.b0": "A.", "r0.b1": "B.", "r0.b2": "C.", "skills.tech": "Go, Redis, AWS" };
  const labels = { summary: "Summary", "r0.b0": "Acme Corp · bullet 1", "skills.tech": "Skills · Technologies" };
  const r = (over: Partial<RunFile> = {}) => report({ labels, edits: [], ...over });

  it("a bullet reorder is a change labelled by role", () => {
    const v = buildRunView(r(), state({ edits: {}, order: { r0: ["r0.b2", "r0.b0", "r0.b1"] } }), m);
    expect(v.changes).toEqual([
      { id: "r0", label: "Acme Corp · bullet order", before: "", after: "", reordered: "Bullet 3 moved to the front." },
    ]);
    const mixed = buildRunView(r(), state({ edits: {}, order: { r0: ["r0.b1", "r0.b2", "r0.b0"] } }), m);
    expect(mixed.changes[0].reordered).toBe("New order: bullets 2, 3, 1.");
    expect(buildRunView(r(), state({ edits: {}, order: { r0: ["r0.b0", "r0.b1", "r0.b2"] } }), m).changes).toEqual([]);
  });

  it("a skills line with the same items is Reordered, not a diff", () => {
    const v = buildRunView(r(), state({ edits: { "skills.tech": "Redis, AWS, Go" } }), m);
    expect(v.changes[0]).toMatchObject({ label: "Skills · Technologies", reordered: "Nothing added or removed." });
    const added = buildRunView(r(), state({ edits: { "skills.tech": "Redis, AWS, Go, Rust" } }), m);
    expect(added.changes[0].reordered).toBeUndefined();
  });

  it("changes follow document order", () => {
    const v = buildRunView(
      r({ edits: [{ id: "skills.tech", before: m["skills.tech"], after: "Go, Redis, GCP" }] }),
      state({ edits: { "skills.tech": "Go, Redis, GCP", "r0.b1": "B2.", summary: "S2." }, order: { r0: ["r0.b1", "r0.b0", "r0.b2"] } }),
      m,
    );
    expect(v.changes.map((c) => c.id)).toEqual(["summary", "r0", "r0.b1", "skills.tech"]);
  });

  it("every embedded id in a warning becomes a label", () => {
    const v = buildRunView(
      r({
        warnings: [
          "Ignored an edit for unknown id r9.b9",
          "Ignored a reorder for unknown role r3",
          "Ignored a reorder for r0: not a permutation of its bullets",
          "r7.b1: dropped metric 40%",
          "skills.tech: dropped Go",
        ],
      }),
      state(),
      m,
    );
    expect(v.warnings).toEqual([
      "Ignored an edit for unknown id a resume part",
      "Ignored a reorder for unknown role a role",
      "Ignored a reorder for Acme Corp: not a permutation of its bullets",
      "A resume part: dropped metric 40%",
      "Skills · Technologies: dropped Go",
    ]);
  });
});

describe("latexToMarked", () => {
  it("never leaks a backslash", () => {
    expect(latexToMarked("trailing\\")).toBe("trailing");
    expect(latexToMarked("1\\,000 users")).toBe("1 000 users");
    expect(latexToMarked("$\\sim$10k req/s")).toBe("~10k req/s");
    expect(latexToMarked("e.g.\\ foo, \\LaTeX{} and \\@ \\!x")).toBe("e.g. foo, LaTeX and x");
  });
  it("bold becomes ** markers, other commands keep their text", () => {
    expect(latexToMarked("Built \\textbf{Rust} and \\textit{Go} \\emph{fast}")).toBe("Built **Rust** and Go fast");
  });
  it("unescapes specials", () => {
    expect(latexToMarked("40\\% of R\\&D at \\$5 \\#1 a\\_b")).toBe("40% of R&D at $5 #1 a_b");
  });
  it("line breaks, ties and dashes", () => {
    expect(latexToMarked("2019--2021\\\\next~line")).toBe("2019–2021 next line");
  });
  it("nested commands and links keep only visible text", () => {
    expect(latexToMarked("\\textbf{\\href{https://x.io}{ApplyMate}} by \\textbf{50\\%}")).toBe("**ApplyMate** by **50%**");
  });
});

describe("Diff", () => {
  const html = (before: string, after: string) => renderToStaticMarkup(createElement(Diff, { before, after }));
  it("renders ins/del with bold kept across split parts, no markers or LaTeX", () => {
    const out = html(
      "in \\textbf{agentic AI tooling} and \\textbf{CI/CD}, 40\\%",
      "in \\textbf{agentic AI systems} and \\textbf{CI/CD}, 40\\%",
    );
    expect(out).toBe("in <b>agentic AI </b><del><b>tooling</b> </del><ins><b>systems</b> </ins>and <b>CI/CD</b>, 40%");
    expect(out).not.toMatch(/\*\*|\\/);
  });
});

describe("nameIds (chat prose)", () => {
  const labels = { summary: "Summary", "r0.b0": "Acme Corp · bullet 1", "r0.b1": "Acme Corp · bullet 2", "skills.tech": "Skills · Technologies" };
  const qs = [{ fieldId: "q1", label: "Why Acme?" }];
  it("bracketed ids, answer:<id> and rN / rN.bN / skills.x tokens become labels", () => {
    expect(nameIds("I tightened [r0.b1] and [summary].", labels, qs)).toBe("I tightened Acme Corp · bullet 2 and Summary.");
    expect(nameIds("See r0.b0, r0 and skills.tech; answer:q1 is thin.", labels, qs)).toBe(
      "See Acme Corp · bullet 1, Acme Corp and Skills · Technologies; Why Acme? is thin.",
    );
    expect(nameIds("Updated [answer:q1].", labels, qs)).toBe("Updated Why Acme?.");
  });
  it("an echoed `[id] Label` keeps one copy of the label", () => {
    expect(nameIds("[r0.b0] Acme Corp · bullet 1 overstates it.", labels, qs)).toBe("Acme Corp · bullet 1 overstates it.");
    expect(nameIds("[answer:q1] Why Acme? reads generic.", labels, qs)).toBe("Why Acme? reads generic.");
  });
  it("leaves the plain word summary and unknown brackets alone", () => {
    expect(nameIds("Your summary is vague [sic].", labels, qs)).toBe("Your summary is vague [sic].");
    expect(nameIds("In summary: fine.", labels, qs)).toBe("In summary: fine.");
  });
  it("unknown ids never show raw", () => {
    expect(nameIds("Drop r9.b9 and answer:zz.", labels, qs)).toBe("Drop a resume part and a form question.");
  });
});
