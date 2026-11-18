import type { PageSyncMsg } from "../../types";
import type { Proposal } from "../../../../../lib/shared/types";

export type SyncRun = {
  runId: string;
  fileName: string;
  version: number;
  hasCoverLetterPdf: boolean;
  // state.questions then report.questions: REFILL_ANSWER goes by label.
  questions: { fieldId: string; label: string }[];
};

export const isResumeTarget = (target: string) => target !== "cover-letter" && !target.startsWith("answer:");

// Sent to every frame of the tab; only a frame that applied it answers "ok".
// Silence (no frame has the field) shows up as undefined, a rejection or a hang.
export async function syncToPage(tabId: number, p: Proposal, run: SyncRun): Promise<"ok" | "not-found"> {
  let msg: PageSyncMsg;
  if (p.target === "cover-letter") {
    msg = { type: "REFILL_COVER_LETTER", runId: run.runId, text: p.after, hasPdf: run.hasCoverLetterPdf, fileName: run.fileName };
  } else if (p.target.startsWith("answer:")) {
    const fieldId = p.target.slice("answer:".length);
    const q = run.questions.find((q) => q.fieldId === fieldId);
    if (!q) return "not-found";
    msg = { type: "REFILL_ANSWER", label: q.label, value: p.after };
  } else {
    msg = { type: "REATTACH_RESUME", runId: run.runId, fileName: run.fileName, version: run.version };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const silence = new Promise<undefined>((r) => (timer = setTimeout(r, 3000, undefined)));
  const res = await Promise.race([chrome.tabs.sendMessage(tabId, msg).catch(() => undefined), silence]);
  clearTimeout(timer);
  return res === "ok" ? "ok" : "not-found";
}
