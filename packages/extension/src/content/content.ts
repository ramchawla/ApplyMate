import { detect } from "./detectors/index";
import { extractJD, extractFormFields } from "./extractors/index";
import { applyFillPlan } from "./fill";
import { ExtractedJobData } from "../types";
import { v4 as uuidv4 } from "uuid";

export async function extractAndSend(html: string): Promise<void> {
  try {
    const detection = detect({ url: getUrl(), html });

    const { jobDescription, jobTitle, company } = extractJD(
      html,
      detection.board,
    );
    const formFields = extractFormFields(html);

    const extractedJobData: ExtractedJobData = {
      id: uuidv4(),
      url: getUrl(),
      timestamp: new Date().toISOString(),
      board: detection.board,
      boardConfidence: detection.confidence,
      jobTitle,
      company,
      jobDescription,
      formFields,
      userValidated: false,
    };

    chrome.runtime.sendMessage({
      type: "JOB_EXTRACTED",
      data: extractedJobData,
    });

    injectExtensionButton();
  } catch (error) {
    chrome.runtime.sendMessage({ type: "ERROR", error: String(error) });
  }
}

function getUrl(): string {
  return typeof window !== "undefined" && window.location
    ? window.location.href
    : "";
}

function injectExtensionButton(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("applymate-button")) return;

  const button = document.createElement("button");
  button.id = "applymate-button";
  button.innerText = "ApplyMate";
  button.style.cssText = [
    "position: fixed",
    "top: 10px",
    "right: 10px",
    "z-index: 10000",
    "padding: 8px 16px",
    "background: #4F46E5",
    "color: white",
    "border: none",
    "border-radius: 6px",
    "cursor: pointer",
    "font-weight: bold",
  ].join(";");

  button.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" });
  });

  document.body.appendChild(button);
}

// Live side effects only run inside a real extension context (onMessage present).
// In unit tests the chrome mock omits onMessage, so this block is skipped.
const inExtension =
  typeof chrome !== "undefined" &&
  !!chrome.runtime &&
  !!(chrome.runtime as { onMessage?: unknown }).onMessage;

// Multi-step ATS wizards (LinkedIn Easy Apply, Workday) inject new fields
// after the initial snapshot; re-extract when form controls appear.
const REEXTRACT_DEBOUNCE_MS = 400;

export function watchForInjectedFields(
  doc: Document,
  onFieldsChanged: () => void,
): MutationObserver {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const observer = new MutationObserver((mutations) => {
    const addedFormControls = mutations.some((m) =>
      Array.from(m.addedNodes).some(
        (node) =>
          node instanceof Element &&
          (node.matches("input, textarea, select, form") ||
            node.querySelector?.("input, textarea, select") !== null),
      ),
    );
    if (!addedFormControls) return;

    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(onFieldsChanged, REEXTRACT_DEBOUNCE_MS);
  });

  observer.observe(doc.body, { childList: true, subtree: true });

  doc.defaultView?.addEventListener("pagehide", () => {
    if (timer !== undefined) clearTimeout(timer);
    observer.disconnect();
  });

  return observer;
}

if (inExtension) {
  console.log("[ApplyMate] Content script loaded on:", getUrl());

  void extractAndSend(document.documentElement.outerHTML);

  watchForInjectedFields(document, () => {
    void extractAndSend(document.documentElement.outerHTML);
  });

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request?.type === "EXTRACT_JOB_DATA") {
      void extractAndSend(document.documentElement.outerHTML);
      sendResponse({ status: "extraction_started" });
      return false;
    }
    if (request?.type === "APPLY_FILL_PLAN") {
      const result = applyFillPlan(
        request.instructions,
        document,
        request.highlightFieldIds ?? [],
      );
      sendResponse(result);
      return false;
    }
    return false;
  });
}
