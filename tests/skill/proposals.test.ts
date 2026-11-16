import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseResume, partLabels } from "../../packages/skill/src/tailor/resume-doc";
import { validateProposals } from "../../packages/skill/src/tailor/proposals";
import type { RunState } from "../../lib/shared/types";

const masterTex = readFileSync(
  fileURLToPath(new URL("./fixtures/resume-master.tex", import.meta.url)),
  "utf8",
);
const doc = parseResume(masterTex);
const masterSummary = doc.parts.find((p) => p.id === "summary")!.text;
const state: RunState = {
  edits: {},
  order: {},
  coverLetter: "old letter",
  answers: {},
  questions: [{ fieldId: "q2", label: "Years of experience", type: "select", options: ["1-2", "3-5"], required: true }],
  version: 0,
};
const ctx = { doc, labels: partLabels(doc), state, corpusYaml: "experiences: []\n" };

describe("validateProposals", () => {
  it("keeps valid proposals, drops bad ones with reasons", () => {
    const r = validateProposals(
      [
        { target: "summary", after: "New \\textbf{x}", why: "w" },
        { target: "r9.b9", after: "x", why: "w" },
        { target: "answer:email", after: "a@b.c", why: "w" },
        { target: "answer:q2", after: "7+", why: "w" },
        { target: "answer:q2", after: "3-5", why: "w" },
        { target: "cover-letter", after: "Dear Hiring Team,…", why: "w" },
        { target: "r0.b0", after: "[r0.b0] Cut cost 87\\%", why: "w" },
        { target: "skills.languages", after: "Go", why: "w" },
      ],
      ctx,
    );
    expect(r.proposals.map((p) => p.target)).toEqual([
      "summary", "answer:q2", "cover-letter", "r0.b0", "skills.languages",
    ]);
    expect(r.dropped).toHaveLength(3);
    expect(r.dropped[0]).toBe("r9.b9: unknown target");
    expect(r.proposals[0]).toMatchObject({ label: "Summary", before: masterSummary });
    expect(r.proposals[1]).toMatchObject({ label: "Years of experience", before: "" });
    expect(r.proposals[2]).toMatchObject({ label: "Cover letter", before: "old letter" });
    expect(r.proposals[3].after.startsWith("[r0.b0]")).toBe(false);
    expect(r.proposals[3].warnings.join(" ")).toMatch(/87/);
    expect(r.proposals[4].warnings.join(" ")).toMatch(/dropped/);
  });

  it("before is the current state value", () => {
    const s = { ...state, edits: { summary: "Edited" } };
    const r = validateProposals([{ target: "summary", after: "Newer", why: "" }], { ...ctx, state: s });
    expect(r.proposals[0].before).toBe("Edited");
  });

  it("tolerates junk and drops no-ops and broken latex", () => {
    expect(validateProposals("nope", ctx)).toEqual({ proposals: [], dropped: [] });
    expect(validateProposals([{ target: "summary", after: "\\textbf{x", why: "" }], ctx).dropped).toHaveLength(1);
    expect(validateProposals([{ target: "summary", after: masterSummary, why: "" }], ctx).dropped).toHaveLength(1);
    expect(validateProposals([null, 3, { target: 1 }], ctx).proposals).toEqual([]);
  });
});
