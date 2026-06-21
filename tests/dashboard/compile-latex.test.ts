import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import {
  compileLatex,
  TectonicMissingError,
} from "../../lib/local/compile-latex";

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
