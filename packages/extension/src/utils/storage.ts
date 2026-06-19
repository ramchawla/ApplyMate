import { ExtractedJobData } from "../types";

export function getExtractedJobData(): Promise<ExtractedJobData | null> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_EXTRACTED_DATA" }, (response) => {
      resolve((response?.data as ExtractedJobData) ?? null);
    });
  });
}

export function updateExtractedJobData(
  data: ExtractedJobData,
): Promise<ExtractedJobData> {
  return new Promise((resolve) => {
    chrome.storage.session.set({ lastExtractedJobData: data }, () => {
      resolve(data);
    });
  });
}
