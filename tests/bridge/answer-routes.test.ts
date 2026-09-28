import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { createServer } from "../../packages/bridge/src/server";

const TOKEN = "tok";
let server: Server;
let base = "";
const auth = { authorization: `Bearer ${TOKEN}` };

beforeAll(async () => {
  server = createServer({
    token: TOKEN,
    answer: async (req) => {
      if (req.job.company === "Boom") throw new Error("claude timed out");
      return { answers: req.fields.map((f) => ({ fieldId: f.fieldId, value: "Yes" })) };
    },
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

async function done(id: string) {
  for (let i = 0; i < 50; i++) {
    const s = await (await fetch(`${base}/answer/${id}`, { headers: auth })).json();
    if (s.status === "done" || s.status === "error") return s;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("never finished");
}

const body = { job: { title: "SRE", company: "Acme", url: "https://x/1" }, fields: [{ fieldId: "q", label: "Q?", type: "text", required: true }] };

describe("/answer", () => {
  it("requires the token", async () => {
    expect((await fetch(`${base}/answer`, { method: "POST", body: JSON.stringify(body) })).status).toBe(401);
  });
  it("queues and returns answers", async () => {
    const res = await fetch(`${base}/answer`, { method: "POST", headers: auth, body: JSON.stringify(body) });
    expect(res.status).toBe(202);
    expect(await done((await res.json()).jobId)).toMatchObject({ status: "done", answers: [{ fieldId: "q", value: "Yes" }] });
  });
  it("reports errors and validates input", async () => {
    const bad = await fetch(`${base}/answer`, { method: "POST", headers: auth, body: JSON.stringify({ job: 1 }) });
    expect(bad.status).toBe(400);
    const res = await fetch(`${base}/answer`, { method: "POST", headers: auth, body: JSON.stringify({ ...body, job: { ...body.job, company: "Boom" } }) });
    expect(await done((await res.json()).jobId)).toMatchObject({ status: "error", error: "claude timed out" });
  });
});

describe("makeAnswerJob", () => {
  it("feeds corpus + profile from the dir to claude and filters answers", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { makeAnswerJob } = await import("../../packages/bridge/src/tailor-job");
    const dir = mkdtempSync(join(tmpdir(), "am-ans-"));
    writeFileSync(join(dir, "experience.yaml"), "corpus-marker");
    writeFileSync(join(dir, "profile.yaml"), "profile-marker");
    let prompt = "";
    const run = makeAnswerJob({
      dir,
      runner: async (o) => {
        prompt = o.prompt;
        return { answers: [{ fieldId: "q", value: "A" }, { fieldId: "zz", value: "B" }] };
      },
    });
    const out = await run({ job: body.job as never, fields: body.fields });
    expect(prompt).toContain("corpus-marker");
    expect(prompt).toContain("profile-marker");
    expect(out.answers).toEqual([{ fieldId: "q", value: "A" }]);
  });
});
