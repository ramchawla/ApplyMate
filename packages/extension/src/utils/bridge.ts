export const BRIDGE_BASE = "http://127.0.0.1:4179";

export function getBridgeToken(): Promise<string> {
  return new Promise((resolve) =>
    chrome.storage.local.get("bridgeToken", (r) => resolve((r.bridgeToken as string) ?? "")),
  );
}

export function saveBridgeToken(token: string): Promise<void> {
  return new Promise((resolve) =>
    chrome.storage.local.set({ bridgeToken: token }, () => resolve()),
  );
}

// The bridge hands its token to the first extension origin that asks, so the
// user never copies it by hand.
export async function pair(): Promise<string> {
  try {
    // POST: Chrome always sends Origin on non-GET requests, which pairing checks.
    const res = await fetch(`${BRIDGE_BASE}/pair`, { method: "POST" });
    if (!res.ok) return "";
    const { token } = (await res.json()) as { token?: string };
    if (token) await saveBridgeToken(token);
    return token ?? "";
  } catch {
    return "";
  }
}

export async function bridgeFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let token = await getBridgeToken();
  if (!token) token = await pair();
  const go = (t: string) =>
    fetch(`${BRIDGE_BASE}${path}`, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string>),
        ...(t ? { authorization: `Bearer ${t}` } : {}),
      },
    });
  let res = await go(token);
  if (res.status === 401) {
    const fresh = await pair();
    if (fresh && fresh !== token) res = await go(fresh);
  }
  return res;
}

export async function isBridgeUp(): Promise<boolean> {
  try {
    return (await fetch(`${BRIDGE_BASE}/health`)).ok;
  } catch {
    return false;
  }
}
