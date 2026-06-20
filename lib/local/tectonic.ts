// Client-side LaTeX -> PDF compilation, zero server cost.
//
// Status: the WASM engine is loaded in a browser context (extension side
// panel / Next.js dashboard, Phase 4), where the Tectonic/SwiftLaTeX WASM
// build is served as a static asset and instantiated against the DOM/Worker
// APIs it needs. There is no published npm package that compiles full LaTeX
// in plain Node, so this module exposes the browser contract and guards the
// Node path with a clear error. The guaranteed Phase 2 artifact is the LaTeX
// string from `assembleLatex`; the dashboard compiles it to a PDF.

export interface TectonicEngine {
  compile(latex: string): Promise<Uint8Array>;
}

export interface TectonicOptions {
  // URL the browser fetches the compiled WASM engine from. Served as a static
  // asset by the dashboard/extension. Required in a browser context.
  engineUrl?: string;
  // Allows tests / the dashboard to inject an already-instantiated engine.
  engine?: TectonicEngine;
}

let cachedEngine: TectonicEngine | null = null;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

async function loadEngine(options: TectonicOptions): Promise<TectonicEngine> {
  if (options.engine) return options.engine;
  if (cachedEngine) return cachedEngine;

  if (!isBrowser()) {
    throw new Error(
      "Tectonic-WASM runs in the browser (dashboard/extension). " +
        "Pass an injected `engine` for Node, or compile the LaTeX in the dashboard.",
    );
  }
  if (!options.engineUrl) {
    throw new Error("engineUrl is required to load the Tectonic-WASM engine.");
  }

  const mod = (await import(/* @vite-ignore */ options.engineUrl)) as {
    createEngine: () => Promise<TectonicEngine>;
  };
  cachedEngine = await mod.createEngine();
  return cachedEngine;
}

export async function compileLatexToPdf(
  latex: string,
  options: TectonicOptions = {},
): Promise<Uint8Array> {
  const engine = await loadEngine(options);
  const pdf = await engine.compile(latex);
  if (pdf[0] !== 0x25 || pdf[1] !== 0x50) {
    throw new Error("Tectonic did not return a PDF.");
  }
  return pdf;
}
