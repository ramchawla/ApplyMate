export function sendToBackground<T = unknown>(message: unknown): Promise<T> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response as T);
    });
  });
}
