"use client";
import { useState } from "react";

export function PdfCompiler({ latex }: { latex: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function compile() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ latex }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          [body.error, body.hint].filter(Boolean).join(" — ") ||
            `compile failed (${res.status})`,
        );
      }
      const blob = await res.blob();
      setUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
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
        {busy ? "Compiling…" : "Compile PDF"}
      </button>

      {error && (
        <div className="space-y-1">
          <pre className="text-xs text-red-600 whitespace-pre-wrap">{error}</pre>
          <p className="text-xs text-gray-500">
            Needs <code>tectonic</code> on the machine running the dashboard
            (<code>brew install tectonic</code>). The Raw LaTeX below can be
            compiled at Overleaf as a fallback.
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
