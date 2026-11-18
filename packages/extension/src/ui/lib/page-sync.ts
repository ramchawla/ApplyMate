import type { PageSyncMsg } from "../../types";
import type { Proposal } from "../../../../../lib/shared/types";
import { jobKey } from "../../lib/jd-cache";

export type SyncRun = {
  runId: string;
  fileName: string;
  version: number;
  hasCoverLetterPdf: boolean;
  // state.questions then report.questions: REFILL_ANSWER goes by label.
  questions: { fieldId: string; label: string }[];
  // The tab's page when the run was tailored (lastRun), else the run's job URL.
  pageUrl: string | undefined;
};

// "no-bridge": the frame with the field couldn't fetch the PDF.
export type SyncResult = "ok" | "not-found" | "other-page" | "no-bridge";

// Same job (posting, apply page, wizard steps share a key). Unknown on either side: no.
export const samePage = (tabUrl: string | undefined, runUrl: string | undefined) =>
  !!tabUrl && !!runUrl && jobKey(tabUrl) === jobKey(runUrl);

export const isResumeTarget = (target: string) => target !== "cover-letter" && !target.startsWith("answer:");

// Sent to every frame of the tab, and only while the tab still shows the run's job
// (else another job's form would get this run's PDF or answer). Only a frame that
// applied it answers; silence (no frame has the field) is undefined, a rejection or a hang.
export async function syncToPage(tabId: number, p: Proposal, run: SyncRun): Promise<SyncResult> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!samePage(tab?.url, run.pageUrl)) return "other-page";
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
  // A re-attach also waits out the site's resume parser before restoring the profile.
  const wait = msg.type === "REATTACH_RESUME" ? 6000 : 3000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const silence = new Promise<undefined>((r) => (timer = setTimeout(r, wait, undefined)));
  const res = await Promise.race([chrome.tabs.sendMessage(tabId, msg).catch(() => undefined), silence]);
  clearTimeout(timer);
  return res === "ok" || res === "no-bridge" ? res : "not-found";
}
