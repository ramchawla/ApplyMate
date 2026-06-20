import { describe, it, expect } from "vitest";
import {
  compileLatexToPdf,
  type TectonicEngine,
} from "../../lib/local/tectonic";

// A fake engine lets us test the wrapper's contract (PDF guard, injection)
// in Node. Real Tectonic/SwiftLaTeX WASM compilation runs in the browser and
// is verified in the Phase 4 dashboard — there is no Node-compatible full
// LaTeX engine on npm.
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); // %PDF-1

const goodEngine: TectonicEngine = {
  async compile() {
    return PDF_BYTES;
  },
};

const badEngine: TectonicEngine = {
  async compile() {
    return new Uint8Array([0x00, 0x01, 0x02]); // not a PDF
  },
};

describe("compileLatexToPdf (contract)", () => {
  it("returns PDF bytes from an injected engine", async () => {
    const pdf = await compileLatexToPdf("\\documentclass{article}", {
      engine: goodEngine,
    });
    expect(pdf[0]).toBe(0x25);
    expect(pdf[1]).toBe(0x50);
  });

  it("throws when the engine does not return a PDF", async () => {
    await expect(
      compileLatexToPdf("bad", { engine: badEngine }),
    ).rejects.toThrow(/did not return a PDF/i);
  });

  it("throws a clear error in Node without an injected engine", async () => {
    await expect(compileLatexToPdf("x")).rejects.toThrow(
      /runs in the browser/i,
    );
  });

  // Real WASM compile is browser-only; verified manually in the dashboard.
  it.skip("compiles real LaTeX to PDF via WASM (browser/dashboard, Phase 4)", () => {});
});
