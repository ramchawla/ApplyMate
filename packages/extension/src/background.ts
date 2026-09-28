import { bridgeFetch } from "./utils/bridge";
import { jobKey } from "./lib/jd-cache";
import { getProfile, normalizeProfile, saveProfile } from "./utils/profile";
import type { Profile, RunReport, TailorRequest } from "./types";

type BgMessage =
  | { type: "GET_PROFILE" }
  | { type: "TAILOR_START"; request: TailorRequest }
  | { type: "TAILOR_POLL"; jobId: string }
  | { type: "FETCH_PDF"; jobId: string; kind: "resume" | "cover-letter" }
  | { type: "MARK_APPLIED"; jobUrl: string; company: string; jobTitle: string }
  | { type: "RUN_REPORT"; report: RunReport }
  | { type: "OPEN_SIDE_PANEL" }
  | { type: "TAB_JOB_KEY" };

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg: BgMessage, sender, sendResponse) => {
  // sidePanel.open() needs the user gesture that is only alive synchronously.
  if (msg?.type === "OPEN_SIDE_PANEL") {
    if (sender.tab?.id !== undefined) {
      void chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
    }
    sendResponse({});
    return false;
  }
  handle(msg, sender).then(sendResponse, (err: unknown) =>
    sendResponse({ error: err instanceof Error ? err.message : String(err) }),
  );
  return true;
});

async function json(res: Response): Promise<unknown> {
  if (!res.ok) throw new Error(`bridge ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

async function freshProfile(): Promise<Profile> {
  try {
    const res = await bridgeFetch("/profile");
    if (res.ok) {
      const profile = normalizeProfile(await res.json());
      await saveProfile(profile);
      return profile;
    }
  } catch {
    // bridge offline — use the cached copy
  }
  return getProfile();
}

async function handle(msg: BgMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const post = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  switch (msg.type) {
    case "GET_PROFILE":
      return freshProfile();
    case "TAILOR_START":
      return json(await bridgeFetch("/tailor", post(msg.request)));
    case "TAILOR_POLL":
      return json(await bridgeFetch(`/tailor/${encodeURIComponent(msg.jobId)}`));
    case "FETCH_PDF": {
      const res = await bridgeFetch(
        `/tailor/${encodeURIComponent(msg.jobId)}/${msg.kind}.pdf`,
      );
      if (!res.ok) throw new Error(`bridge ${res.status}`);
      return { base64: toBase64(await res.arrayBuffer()) };
    }
    case "MARK_APPLIED":
      await json(await bridgeFetch("/applications/applied", post(msg)));
      return { ok: true };
    case "TAB_JOB_KEY":
      // Frames can't see their tab's URL; the side panel keys pasted JDs by it.
      return { key: sender.tab?.url ? jobKey(sender.tab.url) : "" };
    case "RUN_REPORT":
      await chrome.storage.session.set({ [`lastRun:${sender.tab?.id ?? "x"}`]: msg.report });
      return { ok: true };
    default:
      throw new Error("unknown message");
  }
}
