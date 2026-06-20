import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  assembleLatex,
  escapeLatex,
} from "../../packages/skill/src/stages/assemble-latex";
import type { BulletRewrite } from "../../packages/skill/src/types";

const here = dirname(fileURLToPath(import.meta.url));

function bullet(revised: string): BulletRewrite {
  return {
    original: revised,
    revised,
    keywordsAdded: [],
    metricsPreserved: [],
    reasonsForAddition: [],
    invariantChecksPassed: true,
    plausibilityScore: 0.9,
    validationNotes: [],
    warnings: [],
  };
}

describe("escapeLatex", () => {
  it("escapes special characters", () => {
    expect(escapeLatex("C++ & 50% #1 _x")).toBe("C++ \\& 50\\% \\#1 \\_x");
  });
});

describe("assembleLatex", () => {
  it("injects bullets as \\item lines at the marker", async () => {
    const template = await readFile(
      join(here, "fixtures", "resume-template.tex"),
      "utf8",
    );
    const out = assembleLatex(template, [
      bullet("Built async Rust server, 10k req/s"),
      bullet("Led 50% cost reduction"),
    ]);
    expect(out).toContain("\\item Built async Rust server, 10k req/s");
    expect(out).toContain("\\item Led 50\\% cost reduction");
    expect(out).not.toContain("%%BULLETS%%");
  });

  it("produces compilable structure (balanced itemize)", async () => {
    const template = await readFile(
      join(here, "fixtures", "resume-template.tex"),
      "utf8",
    );
    const out = assembleLatex(template, [bullet("One")]);
    expect(out).toContain("\\begin{itemize}");
    expect(out).toContain("\\end{itemize}");
  });
});
