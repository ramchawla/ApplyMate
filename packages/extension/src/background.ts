import { ExtractedJobData } from "./types";

console.log("[ApplyMate] Background service worker started");

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  switch (request?.type) {
    case "JOB_EXTRACTED":
      void handleJobExtracted(request.data as ExtractedJobData);
      sendResponse({ status: "received" });
      return false;

    case "ERROR":
      console.error("[ApplyMate] Content script error:", request.error);
      sendResponse({ status: "error_logged" });
      return false;

    case "OPEN_SIDE_PANEL":
      void openSidePanel();
      sendResponse({ status: "side_panel_opened" });
      return false;

    case "GET_EXTRACTED_DATA":
      chrome.storage.session.get("lastExtractedJobData", (result) => {
        sendResponse({ data: result.lastExtractedJobData ?? null });
      });
      return true; // async response

    default:
      return false;
  }
});

async function handleJobExtracted(data: ExtractedJobData): Promise<void> {
  await chrome.storage.session.set({ lastExtractedJobData: data });
  console.log("[ApplyMate] Stored extracted job data in session:", data.id);
  await openSidePanel();
}

async function openSidePanel(): Promise<void> {
  if (!chrome.sidePanel) {
    console.warn("[ApplyMate] sidePanel API not available");
    return;
  }

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id !== undefined) {
      await chrome.sidePanel.open({ tabId: tab.id });
      console.log("[ApplyMate] Side panel opened");
    }
  } catch (error) {
    console.error("[ApplyMate] Failed to open side panel:", error);
  }
}
