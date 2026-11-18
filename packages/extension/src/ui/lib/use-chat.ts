// A run's review + chat: GET /chat/:runId, streamed turns, apply/undo, page sync, dismissals.
import { useCallback, useEffect, useRef, useState } from "react";
import { bridgeFetch } from "../../utils/bridge";
import { readNdjson } from "./ndjson";
import { syncToPage } from "./page-sync";
import type { ApplyResult, ChatMessage, RunFile, RunState } from "../../../../../lib/shared/types";

export type RunData = { report: RunFile; state: RunState; chat: ChatMessage[]; master: Record<string, string> };
// Per card ("<messageIndex>:<proposalIndex>"), this panel session only.
export type CardUi = { busy?: "apply" | "undo"; error?: string; sync?: "ok" | "not-found"; version?: number };

const json = { "content-type": "application/json" };

export function useChat(runId: string | undefined, version: number | undefined, tabId: number | undefined) {
  const [data, setData] = useState<RunData | { error: string } | null>(null);
  const [streaming, setStreaming] = useState<{ user: string; text: string } | null>(null);
  const [sendError, setSendError] = useState("");
  const [cards, setCards] = useState<Record<string, CardUi>>({});
  const [dismissed, setDismissed] = useState<string[]>([]);
  const abort = useRef<AbortController | null>(null);
  const current = useRef(runId);
  current.current = runId;
  const path = `/chat/${encodeURIComponent(runId ?? "")}`;

  const load = useCallback(async () => {
    if (!runId) return;
    try {
      const res = await bridgeFetch(path);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (current.current === runId) setData({ ...body, master: body.master ?? {}, chat: body.chat ?? [] });
    } catch (err) {
      // A refresh that fails keeps what's on screen.
      if (current.current === runId) setData((d) => (d && "report" in d ? d : { error: (err as Error).message }));
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

  // false = not sent (error, busy or stopped): the caller restores the text.
  async function send(text: string): Promise<boolean> {
    if (!runId || streaming || !text.trim()) return false;
    setSendError("");
    const ac = new AbortController();
    abort.current = ac;
    setStreaming({ user: text, text: "" });
    let done: ChatMessage | null = null;
    let err = "";
    try {
      const res = await bridgeFetch(path, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ message: text }),
        signal: ac.signal,
      });
      if (res.status === 409) err = "Still answering the last message";
      else if (!res.ok || !res.body) err = (await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`;
      else
        await readNdjson(res.body, (e) => {
          if (e.t === "delta") setStreaming((s) => s && { ...s, text: s.text + e.text });
          else if (e.t === "done") done = e.message;
          else err = e.message;
        });
      if (!done && !err) err = "The reply stopped early";
    } catch (e) {
      err = ac.signal.aborted ? "" : `Couldn't reach the bridge: ${(e as Error).message}`;
    }
    if (current.current !== runId) return false;
    setStreaming(null);
    if (ac.signal.aborted) {
      // ponytail: the bridge finishes a stopped turn anyway; one refetch picks it up if it's quick.
      setTimeout(() => void load(), 2000);
      return false;
    }
    const reply = done as ChatMessage | null;
    if (!reply) {
      setSendError(err);
      return false;
    }
    // Same append the bridge makes to chat.json, so message indexes line up.
    setData((d) =>
      d && "report" in d ? { ...d, chat: [...d.chat, { role: "user", text, at: Date.now() }, reply] } : d,
    );
    void load();
    return true;
  }

  const stop = () => abort.current?.abort();

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
      const { report } = data;
      const sync =
        tabId === undefined
          ? "not-found"
          : await syncToPage(tabId, undo ? { ...p, after: p.before } : p, {
              runId,
              fileName: report.fileName,
              version: r.version,
              hasCoverLetterPdf: report.wantCoverLetterPdf,
              questions: [...r.state.questions, ...report.questions],
            });
      setCard(key, { sync, version: r.version });
    } catch (e) {
      setCard(key, { error: `Couldn't reach the bridge: ${(e as Error).message}` });
    }
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

  return { data, load, streaming, sendError, send, stop, cards, apply, dismissed, dismiss, downloadResume };
}

export type Chat = ReturnType<typeof useChat>;
