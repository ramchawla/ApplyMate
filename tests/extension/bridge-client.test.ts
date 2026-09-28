import { describe, it, expect, vi, beforeEach } from "vitest";

let stored: Record<string, unknown> = {};
beforeEach(() => {
  stored = {};
  vi.resetModules();
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (key: string, cb: (r: Record<string, unknown>) => void) => cb({ [key]: stored[key] }),
        set: (items: Record<string, unknown>, cb?: () => void) => {
          Object.assign(stored, items);
          cb?.();
        },
      },
    },
  };
});

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; auth?: string; method?: string }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method,
      auth: (init?.headers as Record<string, string> | undefined)?.authorization,
    });
    return handler(url, init);
  });
  return calls;
}

describe("bridgeFetch", () => {
  it("pairs automatically when no token is stored", async () => {
    const calls = mockFetch((url) =>
      url.endsWith("/pair") ? Response.json({ token: "T1" }) : Response.json({ ok: true }),
    );
    const { bridgeFetch } = await import("../../packages/extension/src/utils/bridge");
    const res = await bridgeFetch("/profile");
    expect(res.ok).toBe(true);
    expect(calls.map((c) => c.url.replace("http://127.0.0.1:4179", ""))).toEqual(["/pair", "/profile"]);
    expect(calls[0].method).toBe("POST"); // POST guarantees Chrome sends Origin
    expect(calls[1].auth).toBe("Bearer T1");
    expect(stored.bridgeToken).toBe("T1");
  });

  it("re-pairs once on 401 (bridge token rotated)", async () => {
    stored.bridgeToken = "OLD";
    mockFetch((url, init) => {
      if (url.endsWith("/pair")) return Response.json({ token: "NEW" });
      const auth = (init?.headers as Record<string, string>).authorization;
      return auth === "Bearer NEW" ? Response.json({ ok: true }) : new Response("no", { status: 401 });
    });
    const { bridgeFetch } = await import("../../packages/extension/src/utils/bridge");
    expect((await bridgeFetch("/profile")).ok).toBe(true);
    expect(stored.bridgeToken).toBe("NEW");
  });
});
