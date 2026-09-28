import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  compileLatex,
  compileLatexWithPages,
  parsePageCount,
  parseFit,
  TectonicMissingError,
  toTectonicCompat,
} from "../../lib/local/compile-latex";

const FIXTURE = fileURLToPath(
  new URL("../skill/fixtures/resume-master.tex", import.meta.url),
);

function hasTectonic(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("tectonic", ["--version"], (err) => resolve(!err));
  });
}

describe("compileLatex", () => {
  it("throws TectonicMissingError when the binary is absent", async () => {
    await expect(
      compileLatex(
        "\\documentclass{article}\\begin{document}x\\end{document}",
        "tectonic-does-not-exist-xyz",
      ),
    ).rejects.toBeInstanceOf(TectonicMissingError);
  });

  it("compiles a minimal document to PDF bytes when tectonic is installed", async () => {
    if (!(await hasTectonic())) return; // skip when not installed
    const pdf = await compileLatex(
      "\\documentclass{article}\\begin{document}Hello ApplyMate.\\end{document}",
    );
    expect(pdf[0]).toBe(0x25);
    expect(pdf[1]).toBe(0x50);
    expect(pdf.length).toBeGreaterThan(400);
  }, 120000);
});

describe("toTectonicCompat", () => {
  it("strips pdfTeX-only glyphtounicode lines", () => {
    const out = toTectonicCompat(
      "\\input{glyphtounicode}\n\\pdfgentounicode=1\n\\begin{document}",
    );
    expect(out).not.toContain("glyphtounicode");
    expect(out).not.toContain("pdfgentounicode");
    expect(out).toContain("\\begin{document}");
  });

  it("swaps fontawesome5 for a fontspec shim that defines the icons", () => {
    const out = toTectonicCompat("\\usepackage{fontawesome5}\n");
    expect(out).not.toContain("{fontawesome5}");
    expect(out).toContain("\\usepackage{fontspec}");
    expect(out).toContain("\\providecommand{\\faGithub}");
    expect(out).toContain("\\providecommand{\\faEnvelope}");
  });

  it("leaves other documents unchanged", () => {
    const tex = "\\documentclass{article}\\begin{document}x\\end{document}";
    expect(toTectonicCompat(tex)).toBe(tex);
  });
});

describe("parsePageCount", () => {
  it("reads the page count from the XeTeX log", () => {
    expect(parsePageCount("Output written on resume.xdv (2 pages, 1234 bytes).")).toBe(2);
    expect(parsePageCount("Output written on resume.xdv (1 page, 99 bytes).")).toBe(1);
    expect(parsePageCount("")).toBe(0);
  });
});

describe("compileLatexWithPages", () => {
  it("compiles a pdfLaTeX-style resume (fontawesome5 + glyphtounicode) to one page", async () => {
    if (!(await hasTectonic())) return;
    const { pdf, pages } = await compileLatexWithPages(readFileSync(FIXTURE, "utf8"));
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pages).toBe(1);
  }, 180000);

  it("reports natural content height and page goal", async () => {
    if (!(await hasTectonic())) return;
    const { height, goal } = await compileLatexWithPages(readFileSync(FIXTURE, "utf8"));
    expect(goal).toBeGreaterThan(600);
    expect(height).toBeGreaterThan(100);
  }, 180000);
});

describe("parseFit", () => {
  it("reads natural height and goal from the probe line", () => {
    expect(parseFit("x\nAMFIT total=798.15698pt goal=751.60756pt\n")).toEqual({
      height: 798.15698,
      goal: 751.60756,
    });
    expect(parseFit("")).toEqual({ height: 0, goal: 0 });
  });
});
