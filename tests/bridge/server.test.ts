import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { request, type Server } from "node:http";
import { createServer } from "../../packages/bridge/src/server";

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

beforeAll(async () => {
  server = createServer();
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

  it("404s removed legacy routes", async () => {
    expect((await fetch(`${base}/output/latest`)).status).toBe(404);
    expect((await fetch(`${base}/resume/keywords`)).status).toBe(404);
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
    const res = await rawGet(port, "/profile", "evil.example.com");
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
  const TOKEN = "secret-123";

  beforeAll(async () => {
    tokenServer = createServer({ token: TOKEN });
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

  it("rejects protected routes without the token", async () => {
    expect((await fetch(`${tokenBase}/profile`)).status).toBe(401);
  });

  it("rejects a wrong token", async () => {
    const res = await fetch(`${tokenBase}/profile`, {
      headers: { authorization: "Bearer nope" },
    });
    expect(res.status).toBe(401);
  });

  it("passes the token check with the bearer token", async () => {
    const res = await fetch(`${tokenBase}/profile`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(404); // authorized; no profile configured
  });
});
