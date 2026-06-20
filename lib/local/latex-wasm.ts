// Browser-only wrapper around the SwiftLaTeX PdfTeX engine. The engine and its
// .wasm are self-hosted under /swiftlatex, so compilation is fully client-side
// (zero server cost).
//
// The vendored PdfTeXEngine.js is a CommonJS build that references `exports`
// and declares `var PdfTeXEngine`. We pre-define a global `exports` object so
// the classic-script load succeeds, then read `window.PdfTeXEngine`.
export interface PdfEngine {
  loadEngine(): Promise<void>;
  writeMemFSFile(name: string, content: string): void;
  setEngineMainFile(name: string): void;
  compileLaTeX(): Promise<{ status: number; pdf?: Uint8Array; log: string }>;
  closeWorker(): void;
}

declare global {
  interface Window {
    PdfTeXEngine?: new () => PdfEngine;
    exports?: Record<string, unknown>;
  }
}

async function loadEngineScript(): Promise<new () => PdfEngine> {
  if (window.PdfTeXEngine) return window.PdfTeXEngine;

  // Shim the CommonJS environment the vendored build expects.
  window.exports = window.exports ?? {};

  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/swiftlatex/PdfTeXEngine.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("failed to load PdfTeXEngine.js"));
    document.head.appendChild(s);
  });

  if (!window.PdfTeXEngine) {
    throw new Error("PdfTeXEngine not found on window after load");
  }
  return window.PdfTeXEngine;
}

export async function compileInBrowser(latex: string): Promise<Blob> {
  const Engine = await loadEngineScript();
  const engine = new Engine();
  await engine.loadEngine();
  engine.writeMemFSFile("main.tex", latex);
  engine.setEngineMainFile("main.tex");
  const result = await engine.compileLaTeX();
  engine.closeWorker();
  if (result.status !== 0 || !result.pdf) {
    throw new Error(`LaTeX compile failed:\n${result.log.slice(-2000)}`);
  }
  return new Blob([result.pdf as BlobPart], { type: "application/pdf" });
}
