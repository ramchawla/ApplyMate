import { detect } from "./detectors/index";
import { extractJD, extractFormFields } from "./extractors/index";
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

if (inExtension) {
  console.log("[ApplyMate] Content script loaded on:", getUrl());

  void extractAndSend(document.documentElement.outerHTML);

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request?.type === "EXTRACT_JOB_DATA") {
      void extractAndSend(document.documentElement.outerHTML);
      sendResponse({ status: "extraction_started" });
    }
    return false;
  });
}
