import { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import "./styles/tailwind.css";
import { BridgeDot, useBridgeUp } from "./components/BridgeStatus";
import { BridgeTokenField } from "./components/BridgeTokenField";
import { Icon } from "./components/Icon";
import { ReportPanel } from "./components/ReportPanel";
import { ChatThread } from "./components/ChatThread";
import { COMPOSER_ID, Composer } from "./components/Composer";
import { useChat } from "./lib/use-chat";
import { jobKey } from "../lib/jd-cache";
import { buildRunView } from "../../../../lib/shared/run-view";
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

function Header({ title, company, up, pills }: { title: string; company: string; up: boolean | null; pills?: [string, string] }) {
  return (
    <div className="flex gap-3 px-4 pt-3.5 pb-2.5">
      <div className="flex-1 min-w-0">
        <div className="text-title font-semibold tracking-tight leading-[1.3] [text-wrap:balance]">{title || "Last run"}</div>
        {company && <div className="text-small text-text-2 mt-0.5">{company}</div>}
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <BridgeDot up={up} on="Bridge" off="Bridge offline" />
        {pills && (
          <span className="flex gap-1">
            <span className="text-meta font-medium text-accent-text bg-accent-soft rounded-full px-2 py-0.5">{pills[0]}</span>
            <span className="text-meta font-medium text-text-2 bg-surface-2 border border-border rounded-full px-2 py-px">
              {pills[1]}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the review" className="px-4 pb-3 grid gap-2">
      <div className="skeleton h-2.5 w-2/3" />
      <div className="skeleton h-2 w-full" />
      <div className="flex gap-3 pt-2">
        {[56, 56, 40, 52, 60].map((w, i) => (
          <div key={i} className="skeleton h-2.5" style={{ width: w }} />
        ))}
      </div>
      <div className="grid gap-2 pt-3">
        <div className="skeleton h-2.5 w-4/5" />
        <div className="skeleton h-2.5 w-3/5" />
        <div className="skeleton h-2.5 w-2/3" />
      </div>
    </div>
  );
}

// What the content script reported, for a run the bridge can't show (yet).
function RunSummary({ report }: { report: RunReport }) {
  const res = report.result;
  return (
    <div className="px-4 pb-3 grid gap-1 text-small text-text-2">
      <p>
        JD: {report.jdSource} · {report.filled} fields filled instantly
        {report.needsYou.length ? ` · ${report.needsYou.length} required fields need you` : ""}
      </p>
      {report.error && <p className="text-err">{report.error}</p>}
      {res && (
        <p>
          {res.fileName} · {res.pages} page · saved to {res.savedTo}
        </p>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col justify-center px-7">
      <h2 className="flex items-center gap-2 mt-3.5 mb-1.5 text-title font-semibold tracking-tight">
        <Icon name="zap" className="w-[18px] h-[18px] text-accent" />
        Nothing tailored on this tab yet
      </h2>
      <p className="mb-[18px] text-text-2">
        Press ⚡ on the application page. When the resume is ready, its review and a chat with Claude show up here.
      </p>
      <ol className="grid gap-2.5 text-text-2">
        {[
          "Open the job's application form",
          "Press ⚡ in the ApplyMate widget",
          "Review what changed, ask for fixes, then submit on the site",
        ].map((s, i) => (
          <li key={i} className="flex gap-2.5">
            <span className="flex-none w-5 h-5 rounded-full border border-border-strong grid place-items-center text-meta text-text-3">
              {i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>
    </div>
  );
}

function App() {
  const tab = useActiveTab();
  const up = useBridgeUp();
  const [report, setReport] = useState<RunReport | null>(null);
  const [jd, setJd] = useState("");
  const [saved, setSaved] = useState(false);
  // The composer's text: Ask buttons fill it, a failed or stopped send restores it.
  const [draft, setDraft] = useState("");
  const [collapse, setCollapse] = useState(0);
  const key = tab?.url ? jobKey(tab.url) : "";
  const chat = useChat(report?.result?.runId, report?.result?.version, tab?.id);
  const run = chat.data;
  const view = useMemo(
    () => (run && "report" in run ? buildRunView(run.report, run.state, run.master) : null),
    [run],
  );

  function ask(text: string) {
    setDraft(text);
    document.getElementById(COMPOSER_ID)?.focus();
  }

  async function submit(text: string) {
    if (!text.trim() || chat.streaming) return;
    setDraft("");
    setCollapse((n) => n + 1);
    if (!(await chat.send(text))) setDraft(text);
  }

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

  const loading = !!report?.result?.runId && run === null;
  const failed = run && "error" in run ? run.error : "";

  return (
    <div className="flex flex-col h-screen">
      {!report ? (
        <EmptyState />
      ) : (
        <div className="flex-none border-b border-border">
          {view ? (
            <>
              <Header
                title={view.title}
                company={view.company}
                up={up}
                pills={[`v${view.version + 1}`, `${view.pages} page${view.pages === 1 ? "" : "s"}`]}
              />
              <ReportPanel
                view={view}
                letterPdf={run && "report" in run ? run.report.wantCoverLetterPdf : false}
                onAsk={ask}
                collapse={collapse}
              />
            </>
          ) : (
            <>
              <Header title={report.title} company={report.company} up={up} />
              {loading ? <Skeleton /> : <RunSummary report={report} />}
              {failed && (
                <p role="alert" className="mx-4 mb-3 px-2.5 py-2 rounded-ctl bg-err-bg text-small text-err">
                  Couldn't load the review: {failed}. Is the bridge running?
                </p>
              )}
            </>
          )}
        </div>
      )}

      {view && run && "report" in run ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <ChatThread data={run} view={view} chat={chat} onSend={(t) => void submit(t)} />
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={() => void submit(draft)}
            onStop={chat.stop}
            streaming={!!chat.streaming}
            error={chat.sendError}
          />
        </div>
      ) : (
        report && <div className="flex-1" />
      )}

      <details className="flex-none border-t border-border" open={!report}>
        <summary className="flex items-center gap-2 px-4 py-2.5 text-small text-text-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
          <Icon name="sliders" />
          Job description and bridge
          <span className="flex-1" />
          <BridgeDot up={up} on="Bridge connected" off="Bridge offline: run pnpm bridge" />
        </summary>
        <div className="grid gap-2.5 px-4 pb-3.5">
          <label className="grid gap-1 text-small text-text-2">
            Paste the job description if the page doesn't show it
            <textarea
              value={jd}
              onChange={(e) => {
                setJd(e.target.value);
                setSaved(false);
              }}
              className="w-full min-h-16 resize-y px-2 py-1.5 text-small bg-surface text-text border border-border-strong rounded-ctl placeholder:text-text-3"
              placeholder="Paste the full posting here"
            />
          </label>
          <button
            type="button"
            onClick={() => void saveJd(jd)}
            disabled={!key}
            className="justify-self-start h-7 px-2.5 text-small font-medium bg-accent text-accent-fg rounded-ctl hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saved ? "Saved" : "Save job description"}
          </button>
          <BridgeTokenField />
        </div>
      </details>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("app") || document.body).render(<App />);
