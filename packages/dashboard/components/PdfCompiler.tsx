"use client";
import { useState } from "react";
import { compileInBrowser } from "../../../lib/local/latex-wasm";

export function PdfCompiler({ latex }: { latex: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function compile() {
    setBusy(true);
    setError(null);
    try {
      const blob = await compileInBrowser(latex);
      setUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={compile}
        disabled={busy}
        className="bg-blue-600 text-white px-3 py-1 rounded text-sm disabled:bg-gray-400"
      >
        {busy ? "Compiling…" : "Compile PDF (client-side)"}
      </button>

      {error && (
        <div className="space-y-1">
          <pre className="text-xs text-red-600 whitespace-pre-wrap">{error}</pre>
          <p className="text-xs text-gray-500">
            The SwiftLaTeX WASM engine runs in your browser, but a full compile
            also needs its TeX format + package assets hosted under{" "}
            <code>/swiftlatex</code> (or its TeXLive endpoint). Until those are
            vendored, copy the Raw LaTeX below into Overleaf to produce the PDF.
          </p>
        </div>
      )}

      {url && (
        <div className="space-y-1">
          <a href={url} download="resume.pdf" className="text-sm text-blue-600">
            Download PDF
          </a>
          <iframe
            src={url}
            className="w-full h-96 border rounded"
            title="resume pdf"
          />
        </div>
      )}
    </div>
  );
}
