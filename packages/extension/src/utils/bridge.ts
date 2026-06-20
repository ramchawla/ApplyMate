const BRIDGE_BASE = "http://127.0.0.1:4179";

// The bridge protects /output routes with a bearer token (printed when you run
// `pnpm bridge`, also saved to ~/.applymate/bridge-token). The user pastes it
// into the side panel once; it is stored in chrome.storage.local.
export function getBridgeToken(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.local.get("bridgeToken", (result) => {
      resolve((result.bridgeToken as string) ?? "");
    });
  });
}

export function saveBridgeToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ bridgeToken: token }, () => resolve());
  });
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getBridgeToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function fetchLatestOutput(): Promise<unknown | null> {
  try {
    const res = await fetch(`${BRIDGE_BASE}/output/latest`, {
      headers: await authHeaders(),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // bridge not running
  }
}

export async function isBridgeUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BRIDGE_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
