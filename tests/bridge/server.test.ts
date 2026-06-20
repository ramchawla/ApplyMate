import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { createServer } from "../../packages/bridge/src/server";
import { OutputStore } from "../../packages/bridge/src/store";

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

  it("sets CORS headers", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
