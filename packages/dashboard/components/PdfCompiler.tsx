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
        <pre className="text-xs text-red-600 whitespace-pre-wrap">{error}</pre>
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
