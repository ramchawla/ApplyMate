import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tailorResume } from "../../packages/skill/src/tailor/run";
import { coverLetterTex, escapeLatex } from "../../packages/skill/src/tailor/letter";
import { parseResume } from "../../packages/skill/src/tailor/resume-doc";
import type { TailorRequest } from "../../lib/shared/types";

const masterTex = readFileSync(
  fileURLToPath(new URL("./fixtures/resume-master.tex", import.meta.url)),
  "utf8",
);
const files = {
  masterTex,
  corpusYaml:
    "experiences:\n  - skills: [kubernetes, rust]\n    metrics: ['500 developers']\n",
  directives: "",
  profileYaml: "name: {first: Jane, last: Dev}\n",
};
const req: TailorRequest = {
  job: { title: "SRE", company: "Acme", url: "https://x/1", description: "Kubernetes" },
  keywords: [],
  fields: [],
  wantCoverLetterPdf: false,
};
const onePage = async (latex: string) => ({ pdf: Buffer.from(latex), pages: 1 });
const runner = (out: unknown) => async () => out;

describe("tailorResume", () => {
  it("applies valid edits and order, reporting before/after", async () => {
    const asked = { ...req, fields: [{ fieldId: "why", label: "Why us?", type: "textarea", required: true }] };
    const out = await tailorResume(asked, files, {
      compile: onePage,
      runClaude: runner({
        edits: [
          {
            id: "r1.b0",
            latex: "Migrated \\textbf{15+ services} to \\textbf{Kubernetes} with HPA.",
          },
        ],
        order: [{ role: "r0", ids: ["r0.b1", "r0.b0"] }],
        keywords: { injected: [{ keyword: "Kubernetes", where: "r1.b0" }], skipped: [] },
        coverLetter: "Dear Hiring Team,\n\nHi.",
        answers: [{ fieldId: "why", value: "Because." }],
      }),
    });
    expect(out.tex).toContain("to \\textbf{Kubernetes} with HPA.");
    expect(out.tex.indexOf("Cut CI time")).toBeLessThan(
      out.tex.indexOf("Built a \\textbf{Rust}"),
    );
    expect(out.edits).toEqual([
      expect.objectContaining({
        id: "r1.b0",
        after: expect.stringContaining("HPA"),
        reverted: undefined,
      }),
    ]);
    expect(out.answers).toEqual([{ fieldId: "why", value: "Because." }]);
    expect(out.warnings).toEqual([]);
    expect(out.coverLetterPdf).toBeUndefined();
  });

  it("returns the order it rendered", async () => {
    const ids = parseResume(masterTex).groups[0].bulletIds;
    const reversed = [...ids].reverse();
    const out = await tailorResume(req, files, {
      compile: onePage,
      runClaude: runner({ order: [{ role: "r0", ids: reversed }] }),
    });
    expect(out.order).toEqual({ r0: reversed });
    const bogus = await tailorResume(req, files, {
      compile: onePage,
      runClaude: runner({ order: [{ role: "r0", ids: ["x"] }] }),
    });
    expect(bogus.order).toEqual({});
  });

  it("reverts LaTeX-breaking edits and ignores unknown ids, with warnings", async () => {
    const out = await tailorResume(req, files, {
      compile: onePage,
      runClaude: runner({
        edits: [
          { id: "r0.b0", latex: "Cut 40% of costs" },
          { id: "r9.b9", latex: "ghost" },
        ],
      }),
    });
    expect(out.tex).toBe(masterTex);
    expect(out.edits[0].reverted).toMatch(/unescaped %/);
    expect(out.warnings.join("\n")).toMatch(/unknown id r9\.b9/);
  });

  it("warns (but keeps) invented metrics and reframed keywords", async () => {
    const out = await tailorResume(req, files, {
      compile: onePage,
      runClaude: runner({
        edits: [
          {
            id: "r1.b0",
            latex: "Migrated \\textbf{15+ services} to \\textbf{Kubernetes}, saving 30 hours.",
          },
        ],
        keywords: { injected: [{ keyword: "Terraform", where: "r1.b0" }], skipped: [] },
      }),
    });
    expect(out.tex).toContain("saving 30 hours");
    expect(out.warnings.join("\n")).toMatch(/invented metric 30/);
    expect(out.warnings.join("\n")).toMatch(/Terraform/);
  });

  it("reverts the largest-growth edit until the resume fits one page", async () => {
    const limit = masterTex.length + 40;
    const out = await tailorResume(req, files, {
      compile: async (latex) => ({
        pdf: Buffer.from("x"),
        pages: latex.length > limit ? 2 : 1,
      }),
      runClaude: runner({
        edits: [
          {
            id: "r0.b0",
            latex:
              "Built a \\textbf{Rust} HTTP service handling \\textbf{10k req/s} at \\textbf{100ms} p99 for payments.",
          },
          {
            id: "r1.b0",
            latex: `Migrated \\textbf{15+ services} to \\textbf{Kubernetes}${" and more".repeat(20)}.`,
          },
        ],
      }),
    });
    expect(out.pages).toBe(1);
    expect(out.edits.find((e) => e.id === "r1.b0")!.reverted).toMatch(/one page/);
    expect(out.edits.find((e) => e.id === "r0.b0")!.reverted).toBeUndefined();
  });

  it("reverts growth that would squeeze the page past the master's natural height", async () => {
    // One page, but taller than the master: TeX shrinks the glue and headings
    // collide. Height tracks length here.
    const out = await tailorResume(req, files, {
      compile: async (latex) => ({
        pdf: Buffer.from("x"),
        pages: 1,
        height: latex.length / 10,
        goal: masterTex.length / 10 - 50,
      }),
      runClaude: runner({
        edits: [
          {
            id: "r1.b0",
            latex: `Migrated \\textbf{15+ services} to \\textbf{Kubernetes}${" and more".repeat(20)}.`,
          },
          { id: "r0.b1", latex: "Cut CI by \\textbf{40\\%}." },
        ],
      }),
    });
    expect(out.edits.find((e) => e.id === "r1.b0")!.reverted).toMatch(/one page/);
    expect(out.edits.find((e) => e.id === "r0.b1")!.reverted).toBeUndefined();
  });

  it("keeps growth of up to one text line over the master (TeX absorbs it cleanly)", async () => {
    const out = await tailorResume(req, files, {
      compile: async (latex) => ({
        pdf: Buffer.from("x"),
        pages: 1,
        height: latex === masterTex ? 700 : 711,
        goal: 690,
      }),
      runClaude: runner({ edits: [{ id: "r0.b1", latex: "Cut CI time by \\textbf{40\\%} with parallel \\textbf{GitHub Actions} matrix jobs." }] }),
    });
    expect(out.edits[0].reverted).toBeUndefined();
  });

  it("re-applies edits the greedy pass reverted unnecessarily", async () => {
    // A grows a lot but wraps into the same lines; B grows a little but adds
    // a line. Greedy reverts A first, then B; add-back must restore A.
    const A = `Migrated \\textbf{15+ services} to \\textbf{Kubernetes}${" x".repeat(150)}.`;
    const B = "Cut CI time by \\textbf{40\\%} with parallel \\textbf{GitHub Actions} jobs today.";
    const out = await tailorResume(req, files, {
      compile: async (latex) => ({
        pdf: Buffer.from("x"),
        pages: 1,
        height: 700 + (latex.includes("jobs today") ? 20 : 0),
        goal: 690,
      }),
      runClaude: runner({ edits: [{ id: "r1.b0", latex: A }, { id: "r0.b1", latex: B }] }),
    });
    expect(out.edits.find((e) => e.id === "r1.b0")!.reverted).toBeUndefined();
    expect(out.edits.find((e) => e.id === "r0.b1")!.reverted).toMatch(/one page/);
    expect(out.tex).toContain(" x x x");
  });

  it("warns when a skills line drops items", async () => {
    const out = await tailorResume(req, files, {
      compile: onePage,
      runClaude: runner({ edits: [{ id: "skills.technologies", latex: "Redis, Kubernetes" }] }),
    });
    expect(out.warnings.join("\n")).toMatch(/skills\.technologies: dropped GitHub Actions/);
  });

  it("drops answers for fields that were never asked (hallucinated or injected)", async () => {
    const out = await tailorResume(
      { ...req, fields: [{ fieldId: "why", label: "Why us?", type: "textarea", required: true }] },
      files,
      {
        compile: onePage,
        runClaude: runner({
          answers: [
            { fieldId: "why", value: "Because." },
            { fieldId: "email", value: "attacker@evil.test" },
          ],
        }),
      },
    );
    expect(out.answers).toEqual([{ fieldId: "why", value: "Because." }]);
  });

  it("falls back to the master resume when the edited resume fails to compile", async () => {
    const out = await tailorResume(req, files, {
      compile: async (latex) => {
        if (latex !== masterTex) throw new Error("tectonic failed: boom");
        return { pdf: Buffer.from("master"), pages: 1 };
      },
      runClaude: runner({
        edits: [{ id: "r0.b0", latex: "Fine text" }],
        order: [{ role: "r0", ids: [...parseResume(masterTex).groups[0].bulletIds].reverse() }],
      }),
    });
    expect(out.tex).toBe(masterTex);
    expect(out.order).toEqual({});
    expect(out.pdf.toString()).toBe("master");
    expect(out.warnings.join("\n")).toMatch(/fell back to your master resume/);
  });

  it("compiles a cover letter PDF only when asked", async () => {
    const compiled: string[] = [];
    const out = await tailorResume({ ...req, wantCoverLetterPdf: true }, files, {
      compile: async (latex) => {
        compiled.push(latex);
        return { pdf: Buffer.from("pdf"), pages: 1 };
      },
      runClaude: runner({ coverLetter: "Dear Hiring Team,\n\nI like 100% of it." }),
    });
    expect(out.coverLetterPdf).toBeDefined();
    expect(compiled[1]).toContain("Jane Dev");
    expect(compiled[1]).toContain("100\\% of it");
  });
});

describe("coverLetterTex", () => {
  it("escapes specials and keeps line breaks", () => {
    const t = coverLetterTex("A & B", "Sincerely,\nA & B");
    expect(t).toContain("A \\& B");
    expect(t).toContain("Sincerely,\\\\\nA \\& B");
  });
});

describe("escapeLatex", () => {
  it("escapes special characters", () => {
    expect(escapeLatex("C++ & 50% #1 _x")).toBe("C++ \\& 50\\% \\#1 \\_x");
    expect(escapeLatex("a\\b {c} ~ ^")).toBe(
      "a\\textbackslash{}b \\{c\\} \\textasciitilde{} \\textasciicircum{}",
    );
  });
});
