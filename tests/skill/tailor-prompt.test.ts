import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseResume } from "../../packages/skill/src/tailor/resume-doc";
import {
  buildTailorPrompt,
  parseTailorOutput,
  TAILOR_SCHEMA,
  TAILOR_SYSTEM,
} from "../../packages/skill/src/tailor/prompt";
import type { TailorRequest } from "../../lib/shared/types";

const tex = readFileSync(
  fileURLToPath(new URL("./fixtures/resume-master.tex", import.meta.url)),
  "utf8",
);
const ctx = {
  doc: parseResume(tex),
  corpusYaml: "experiences: []",
  directives: "Lead with X",
  profileYaml: "name: {first: Jane}",
};
const req: TailorRequest = {
  job: {
    title: "Platform Engineer",
    company: "Acme",
    url: "https://x/1",
    description: "We use Kubernetes and Terraform.",
  },
  keywords: ["terraform", "go"],
  fields: [
    { fieldId: "auth", label: "Authorized to work?", type: "select", options: ["Yes", "No"], required: true },
    { fieldId: "why", label: "Why Acme?", type: "textarea", required: false },
  ],
  wantCoverLetterPdf: false,
};

describe("buildTailorPrompt", () => {
  const p = buildTailorPrompt(req, ctx);
  it("lists every editable id under its role heading", () => {
    for (const id of ["summary", "r0.b0", "r0.b1", "r1.b0", "r2.b0", "skills.languages"]) {
      expect(p).toContain(`[${id}]`);
    }
    expect(p).toContain("## r0 — Acme Corp");
  });
  it("includes JD, priority keywords, questions with options, corpus, directives, profile", () => {
    expect(p).toContain("We use Kubernetes and Terraform.");
    expect(p).toContain("terraform, go");
    expect(p).toContain("[auth] Authorized to work? (select; required; options: Yes | No)");
    expect(p).toContain("[why] Why Acme? (textarea; optional)");
    expect(p).toContain("experiences: []");
    expect(p).toContain("Lead with X");
    expect(p).toContain("name: {first: Jane}");
  });
  it("gives every part a character budget equal to its current length", () => {
    const b0 = ctx.doc.parts.find((x) => x.id === "r0.b0")!;
    expect(p).toContain(`[r0.b0] (max ${b0.text.length} chars) ${b0.text}`);
    expect(TAILOR_SYSTEM).toMatch(/max N chars/);
  });

  it("says so when the JD is unavailable", () => {
    const q = buildTailorPrompt({ ...req, job: { ...req.job, description: "" } }, ctx);
    expect(q).toMatch(/not available/i);
  });
});

describe("schema + system", () => {
  it("requires every output key", () => {
    expect((TAILOR_SCHEMA as { required: string[] }).required).toEqual([
      "edits",
      "order",
      "keywords",
      "coverLetter",
      "answers",
    ]);
  });
  it("forbids inventing metrics and demands exact options", () => {
    expect(TAILOR_SYSTEM).toMatch(/Never invent metrics/);
    expect(TAILOR_SYSTEM).toMatch(/exactly one of the listed options/);
  });
});

describe("parseTailorOutput", () => {
  it("strips an echoed [id] prefix from edits", () => {
    const out = parseTailorOutput({
      edits: [
        { id: "r1.b0", latex: "[r1.b0] Designed \\textbf{x}" },
        { id: "skills.technologies", latex: " [skills.technologies]  Kubernetes, Go" },
        { id: "summary", latex: "[other] keep" },
      ],
    });
    expect(out.edits.map((e) => e.latex)).toEqual([
      "Designed \\textbf{x}",
      "Kubernetes, Go",
      "[other] keep",
    ]);
  });

  it("normalizes missing and malformed parts", () => {
    const out = parseTailorOutput({
      edits: [{ id: "r0.b0", latex: "x" }, { id: 3 }],
      keywords: { injected: [{ keyword: "go", where: "r2.b0" }] },
    });
    expect(out.edits).toEqual([{ id: "r0.b0", latex: "x" }]);
    expect(out.order).toEqual([]);
    expect(out.keywords.skipped).toEqual([]);
    expect(out.coverLetter).toBe("");
    expect(out.answers).toEqual([]);
  });
});
