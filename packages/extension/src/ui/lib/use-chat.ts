// A run's review + chat: GET /chat/:runId, streamed turns, apply/undo, page sync, dismissals.
import { useCallback, useEffect, useRef, useState } from "react";
import { bridgeFetch } from "../../utils/bridge";
import { readNdjson } from "./ndjson";
import { syncToPage, type SyncResult } from "./page-sync";
import { pollUntil } from "./chat-logic";
import type { ApplyResult, ChatMessage, Proposal, RunFile, RunState } from "../../../../../lib/shared/types";

export type RunData = { report: RunFile; state: RunState; chat: ChatMessage[]; master: Record<string, string> };
// Per card ("<messageIndex>:<proposalIndex>"), this panel session only.
export type CardUi = { busy?: "apply" | "undo" | "fill"; error?: string; sync?: SyncResult; version?: number };

const json = { "content-type": "application/json" };

// `pageUrl`: the tab's page when this run was tailored; page sync fills only that job's form.
export function useChat(
  runId: string | undefined,
  version: number | undefined,
  tabId: number | undefined,
  pageUrl: string | undefined,
) {
  const [data, setData] = useState<RunData | { error: string } | null>(null);
  // `finishing`: the bridge is still running a turn this panel can't stream (stopped, cut off,
  // or another one in flight); a muted line stands in for the reply until it lands.
  const [streaming, setStreaming] = useState<{ user: string | null; text: string; finishing?: string } | null>(null);
  const [sendError, setSendError] = useState("");
  const [cards, setCards] = useState<Record<string, CardUi>>({});
  const [dismissed, setDismissed] = useState<string[]>([]);
  const abort = useRef<AbortController | null>(null);
  const current = useRef(runId);
  current.current = runId;
  const seq = useRef(0);
  const path = `/chat/${encodeURIComponent(runId ?? "")}`;

  // Only the last-issued load lands. Resolves to the run as loaded (null if stale or failed).
  const load = useCallback(async (): Promise<RunData | null> => {
    const n = ++seq.current;
    if (!runId) return null;
    try {
      const res = await bridgeFetch(path);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (n !== seq.current) return null;
      const run: RunData = { ...body, master: body.master ?? {}, chat: body.chat ?? [] };
      setData(run);
      return run;
    } catch (err) {
      // A refresh that fails keeps what's on screen.
      if (n === seq.current) setData((d) => (d && "report" in d ? d : { error: (err as Error).message }));
      return null;
    }
  }, [runId, path]);

  // Only a new run blanks the panel; a version bump (wizard re-attach) refreshes in place.
  useEffect(() => {
    setData(null);
    setCards({});
    setSendError("");
    setStreaming(null);
    abort.current?.abort();
    if (!runId) return setDismissed([]);
    const k = `dismissed:${runId}`;
    chrome.storage.session.get(k, (r) => setDismissed((r[k] as string[]) ?? []));
  }, [runId]);
  useEffect(() => void load(), [load, version]);

  const setCard = (key: string, ui: CardUi) => setCards((c) => ({ ...c, [key]: ui }));

  // Poll until chat.json holds more than `base` messages. false = gave up (or the run changed).
  async function waitForTurn(base: number): Promise<boolean> {
    const alive = () => current.current === runId;
    const r = await pollUntil(async () => ((await load())?.chat.length ?? 0) > base, alive);
    if (alive()) setStreaming(null);
    if (r === "timeout") setSendError("Couldn't get the reply. Try again.");
    return r === "done";
  }

  // `restore` gets the text back when the message didn't become a turn (never into another run).
  async function send(text: string, restore: (text: string) => void): Promise<void> {
    if (!runId || streaming || !text.trim() || !data || !("report" in data)) return;
    const base = data.chat.length;
    const alive = () => current.current === runId;
    const giveBack = () => {
      if (alive()) restore(text);
    };
    setSendError("");
    const ac = new AbortController();
    abort.current = ac;
    setStreaming({ user: text, text: "" });
    let done: ChatMessage | null = null;
    let err = "";
    let accepted = false; // the bridge started the turn: it persists it whatever happens here
    try {
      const res = await bridgeFetch(path, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ message: text }),
        signal: ac.signal,
      });
      if (res.status === 409) {
        // Another turn is running (often a stopped one): this message wasn't taken.
        giveBack();
        setSendError("Still answering the last message");
        setStreaming({ user: null, text: "", finishing: "Finishing the last reply…" });
        if (await waitForTurn(base)) setSendError("");
        return;
      }
      if (!res.ok || !res.body) err = (await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`;
      else {
        accepted = true;
        await readNdjson(res.body, (e) => {
          if (e.t === "delta") setStreaming((s) => s && { ...s, text: s.text + e.text });
          else if (e.t === "done") done = e.message;
          else err = e.message;
        });
      }
    } catch (e) {
      if (!accepted && !ac.signal.aborted) err = `Couldn't reach the bridge: ${(e as Error).message}`;
    }
    if (!alive()) return;
    const reply = done as ChatMessage | null;
    if (reply) {
      setStreaming(null);
      // Same append the bridge makes to chat.json, unless the thread moved since send.
      setData((d) =>
        d && "report" in d && d.chat.length === base
          ? { ...d, chat: [...d.chat, { role: "user", text, at: Date.now() }, reply] }
          : d,
      );
      void load();
      return;
    }
    if (err) {
      // Refused, or the turn failed (an error event): nothing new to show.
      setStreaming(null);
      setSendError(err);
      if (accepted) void load();
      return giveBack();
    }
    // Stopped or cut off mid-stream: the bridge still finishes and saves the turn.
    setStreaming({ user: text, text: "", finishing: "Finishing the stopped reply…" });
    if (!(await waitForTurn(base))) giveBack();
  }

  const stop = () => abort.current?.abort(); // no-op once finishing

  // Push a proposal's value (or, after an undo, its `before`) into the page.
  async function pushToPage(key: string, p: Proposal, undo: boolean, version: number, state: RunState) {
    if (!runId || !data || !("report" in data)) return;
    const { report } = data;
    const sync =
      tabId === undefined
        ? "other-page"
        : await syncToPage(tabId, undo ? { ...p, after: p.before } : p, {
            runId,
            fileName: report.fileName,
            version,
            hasCoverLetterPdf: report.wantCoverLetterPdf,
            questions: [...state.questions, ...report.questions],
            pageUrl: pageUrl || report.job.url,
          });
    setCard(key, { sync, version });
  }

  async function apply(mi: number, pi: number, undo = false) {
    if (!runId || !data || !("report" in data)) return;
    const p = data.chat[mi]?.proposals?.[pi];
    const key = `${mi}:${pi}`;
    if (!p || cards[key]?.busy) return;
    setCard(key, { busy: undo ? "undo" : "apply" });
    try {
      const res = await bridgeFetch(`${path}/apply`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ messageIndex: mi, proposalIndex: pi, ...(undo ? { undo: true } : {}) }),
      });
      const r = (await res.json().catch(() => ({}))) as ApplyResult | { error?: string };
      if (!("ok" in r) || !r.ok) {
        return setCard(key, { error: ("reason" in r && r.reason) || ("error" in r && r.error) || `HTTP ${res.status}` });
      }
      await load();
      await pushToPage(key, p, undo, r.version, r.state);
    } catch (e) {
      setCard(key, { error: `Couldn't reach the bridge: ${(e as Error).message}` });
    }
  }

  // "Fill again" on a card the page didn't take: the same gated sync of what the run
  // holds now for that target (applied or undone since), nothing re-applied.
  async function fillAgain(mi: number, pi: number) {
    if (!runId || !data || !("report" in data)) return;
    const p = data.chat[mi]?.proposals?.[pi];
    const key = `${mi}:${pi}`;
    if (!p || cards[key]?.busy) return;
    const { state } = data;
    const after =
      p.target === "cover-letter"
        ? state.coverLetter
        : p.target.startsWith("answer:")
          ? (state.answers[p.target.slice("answer:".length)] ?? "")
          : p.after; // a resume part re-attaches the run's current PDF
    setCard(key, { ...cards[key], busy: "fill" });
    await pushToPage(key, { ...p, after }, false, state.version, state);
  }

  function dismiss(key: string, on: boolean) {
    if (!runId) return;
    const next = on ? [...new Set([...dismissed, key])] : dismissed.filter((k) => k !== key);
    setDismissed(next);
    void chrome.storage.session.set({ [`dismissed:${runId}`]: next });
  }

  async function downloadResume() {
    if (!data || !("report" in data)) return;
    try {
      const res = await bridgeFetch(`${path}/resume.pdf`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // The token can't go in a URL, so the PDF goes through a blob.
      const url = URL.createObjectURL(await res.blob());
      const a = Object.assign(document.createElement("a"), { href: url, download: data.report.fileName || "resume.pdf" });
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setSendError(`Couldn't download the PDF: ${(e as Error).message}`);
    }
  }

  return { data, load, streaming, sendError, send, stop, cards, apply, fillAgain, dismissed, dismiss, downloadResume };
}

export type Chat = ReturnType<typeof useChat>;
