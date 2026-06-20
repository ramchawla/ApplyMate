import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { request, type Server } from "node:http";
import { createServer } from "../../packages/bridge/src/server";
import { OutputStore } from "../../packages/bridge/src/store";

// Raw request lets us set a spoofed Host header that undici's fetch forbids.
function rawGet(
  port: number,
  path: string,
  host: string,
): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path, method: "GET", headers: { host } },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0 });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

let server: Server;
let base: string;
const store = new OutputStore();

beforeAll(async () => {
  server = createServer(store);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("bridge server", () => {
  it("responds to health", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("rejects POST without jobUrl", async () => {
    const res = await fetch(`${base}/output`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resumeLatex: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("stores and returns the latest output", async () => {
    const post = await fetch(`${base}/output`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jobUrl: "https://x.com/j",
        resumeLatex: "\\item A",
      }),
    });
    expect(post.status).toBe(200);

    const get = await fetch(`${base}/output/latest`);
    const body = await get.json();
    expect(body.jobUrl).toBe("https://x.com/j");
    expect(body.resumeLatex).toBe("\\item A");
  });

  it("reflects CORS only for a chrome-extension origin", async () => {
    const ext = await fetch(`${base}/health`, {
      headers: { origin: "chrome-extension://abc" },
    });
    expect(ext.headers.get("access-control-allow-origin")).toBe(
      "chrome-extension://abc",
    );

    const web = await fetch(`${base}/health`, {
      headers: { origin: "https://evil.example.com" },
    });
    expect(web.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects a non-loopback Host header (DNS rebinding defense)", async () => {
    const port = Number(new URL(base).port);
    const res = await rawGet(port, "/output/latest", "evil.example.com");
    expect(res.status).toBe(403);
  });

  it("allows a loopback Host header", async () => {
    const port = Number(new URL(base).port);
    const res = await rawGet(port, "/health", `localhost:${port}`);
    expect(res.status).toBe(200);
  });
});

describe("bridge server with token", () => {
  let tokenServer: Server;
  let tokenBase: string;
  const tokenStore = new OutputStore();
  const TOKEN = "secret-123";

  beforeAll(async () => {
    tokenServer = createServer(tokenStore, { token: TOKEN });
    await new Promise<void>((r) => tokenServer.listen(0, r));
    const addr = tokenServer.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    tokenBase = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => tokenServer.close(() => r()));
  });

  it("leaves /health open without a token", async () => {
    const res = await fetch(`${tokenBase}/health`);
    expect(res.status).toBe(200);
  });

  it("rejects /output/latest without the token", async () => {
    const res = await fetch(`${tokenBase}/output/latest`);
    expect(res.status).toBe(401);
  });

  it("allows /output/latest with the bearer token", async () => {
    const res = await fetch(`${tokenBase}/output/latest`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
  });
});
