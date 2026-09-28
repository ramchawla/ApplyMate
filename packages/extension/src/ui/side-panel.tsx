import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "./styles/tailwind.css";
import { BridgeStatus } from "./components/BridgeStatus";
import { BridgeTokenField } from "./components/BridgeTokenField";
import { jobKey } from "../lib/jd-cache";
import type { RunReport } from "../types";

function useActiveTab() {
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  useEffect(() => {
    const load = () =>
      chrome.tabs.query({ active: true, currentWindow: true }, ([t]) => setTab(t ?? null));
    load();
    chrome.tabs.onActivated.addListener(load);
    chrome.tabs.onUpdated.addListener(load);
    return () => {
      chrome.tabs.onActivated.removeListener(load);
      chrome.tabs.onUpdated.removeListener(load);
    };
  }, []);
  return tab;
}

function App() {
  const tab = useActiveTab();
  const [report, setReport] = useState<RunReport | null>(null);
  const [jd, setJd] = useState("");
  const [saved, setSaved] = useState(false);
  const key = tab?.url ? jobKey(tab.url) : "";

  useEffect(() => {
    if (tab?.id === undefined) return;
    const storageKey = `lastRun:${tab.id}`;
    chrome.storage.session.get(storageKey, (r) =>
      setReport((r[storageKey] as RunReport) ?? null),
    );
    const onChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes[storageKey]) setReport(changes[storageKey].newValue as RunReport);
    };
    chrome.storage.session.onChanged.addListener(onChange);
    return () => chrome.storage.session.onChanged.removeListener(onChange);
  }, [tab?.id]);

  useEffect(() => {
    chrome.storage.local.get("jdOverrides", (r) =>
      setJd(((r.jdOverrides ?? {}) as Record<string, string>)[key] ?? ""),
    );
    setSaved(false);
  }, [key]);

  async function saveJd(text: string) {
    const r = await chrome.storage.local.get("jdOverrides");
    const overrides = { ...((r.jdOverrides ?? {}) as Record<string, string>) };
    if (text.trim()) overrides[key] = text.trim();
    else delete overrides[key];
    await chrome.storage.local.set({ jdOverrides: overrides });
    setSaved(true);
  }

  const res = report?.result;
  return (
    <div className="p-3 space-y-4 text-sm bg-white min-h-screen">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-base">⚡ ApplyMate</h1>
        <BridgeStatus />
      </div>

      {!report && (
        <p className="text-gray-500 text-xs">
          Click ⚡ Autofill &amp; Tailor on an application page. The run's details show up here.
        </p>
      )}

      {report && (
        <section className="space-y-2">
          <h2 className="font-semibold">
            {[report.title, report.company].filter(Boolean).join(" · ") || "Last run"}
          </h2>
          <p className="text-xs text-gray-600">
            JD: {report.jdSource} · {report.filled} fields filled instantly
            {report.needsYou.length
              ? ` · ${report.needsYou.length} required fields need you`
              : ""}
          </p>
          {report.error && <p className="text-xs text-red-700">{report.error}</p>}
          {res && (
            <>
              <p className="text-xs">
                📄 {res.fileName} · {res.pages} page · saved to <code>{res.savedTo}</code>
              </p>
              <div className="flex flex-wrap gap-1">
                {res.keywords.injected.map((k) => (
                  <span
                    key={`i-${k.keyword}`}
                    className="bg-green-100 text-green-800 rounded px-1.5 text-xs"
                    title={k.where}
                  >
                    ✓ {k.keyword}
                  </span>
                ))}
                {res.keywords.skipped.map((k) => (
                  <span
                    key={`s-${k.keyword}`}
                    className="bg-gray-100 text-gray-600 rounded px-1.5 text-xs"
                    title={k.reason}
                  >
                    ✗ {k.keyword}
                  </span>
                ))}
              </div>
              {res.warnings.length > 0 && (
                <ul className="text-xs text-amber-700 list-disc ml-4">
                  {res.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
              <details>
                <summary className="cursor-pointer text-xs font-medium">
                  Bullet changes ({res.edits.length})
                </summary>
                {res.edits.map((e) => (
                  <div key={e.id} className="border rounded p-2 my-1 text-xs space-y-1">
                    <div className="text-gray-400">
                      {e.id}
                      {e.reverted ? ` — reverted: ${e.reverted}` : ""}
                    </div>
                    <div className="line-through text-gray-400">{e.before}</div>
                    <div>{e.after}</div>
                  </div>
                ))}
              </details>
              <details>
                <summary className="cursor-pointer text-xs font-medium">Cover letter</summary>
                <textarea
                  readOnly
                  value={res.coverLetter}
                  className="w-full border rounded p-1 h-40 text-xs"
                />
              </details>
            </>
          )}
        </section>
      )}

      <section className="space-y-1">
        <h2 className="font-semibold text-xs">Paste JD for this page</h2>
        <p className="text-xs text-gray-500">Overrides the auto-detected JD for this job.</p>
        <textarea
          value={jd}
          onChange={(e) => {
            setJd(e.target.value);
            setSaved(false);
          }}
          className="w-full border rounded p-1 h-24 text-xs"
          placeholder="Paste the job description…"
        />
        <button
          onClick={() => void saveJd(jd)}
          disabled={!key}
          className="bg-gray-800 text-white rounded px-2 py-1 text-xs"
        >
          {saved ? "Saved ✓" : "Save JD"}
        </button>
      </section>

      <details>
        <summary className="cursor-pointer text-xs text-gray-500">
          Bridge pairing (automatic; manual fallback)
        </summary>
        <BridgeTokenField />
      </details>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("app") || document.body).render(<App />);
