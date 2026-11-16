import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { createServer } from "../../packages/bridge/src/server";
import { makeChat } from "../../packages/bridge/src/chat";
import { readRun } from "../../lib/local/runs";
import { setupRun, tailorOutput } from "./run-fixture";

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

describe("/answer joins the run", () => {
  const q1 = { fieldId: "q1", label: "Pre-existing?", type: "text", required: true };
  const q2 = { fieldId: "q2", label: "Why us?", type: "text", required: true };
  const answerBody = { ...body, fields: [q2] };

  async function serve(runId: string, tailor: () => Promise<ReturnType<typeof tailorOutput>>) {
    const s = await setupRun(runId, [q1]);
    const srv = createServer({
      token: TOKEN,
      chat: makeChat(s),
      tailor,
      answer: async (req) => ({ answers: req.fields.map((f) => ({ fieldId: f.fieldId, value: "Because" })) }),
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const a = srv.address();
    const url = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
    const post = async (path: string, b: unknown) =>
      (await (await fetch(`${url}${path}`, { method: "POST", headers: auth, body: JSON.stringify(b) })).json()).jobId as string;
    const wait = async (path: string, until = (s: { status: string }) => s.status === "done" || s.status === "error") => {
      for (let i = 0; i < 100; i++) {
        const s = await (await fetch(`${url}${path}`, { headers: auth })).json();
        if (until(s)) return s;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error("never finished");
    };
    return { ...s, srv, post, wait, state: () => readRun(s.runDir).state };
  }

  const tailorBody = { ...body, keywords: [], wantCoverLetterPdf: false };

  it("/answer with tailorJobId merges answers into the run state (tailoring already done)", async () => {
    const t = await serve("run-m", async () => tailorOutput("run-m", [q1]));
    try {
      const tj = await t.post("/tailor", tailorBody);
      await t.wait(`/tailor/${tj}`);
      const aj = await t.post("/answer", { ...answerBody, tailorJobId: tj });
      expect(await t.wait(`/answer/${aj}`)).toMatchObject({ status: "done" });
      await t.wait(`/tailor/${tj}`, (s: any) => s.result?.answers?.length === 1);
      expect(t.state().answers).toEqual({ q2: "Because" });
      expect(t.state().questions.map((q) => q.fieldId)).toEqual(["q1", "q2"]);
      expect(t.state().version).toBe(0);
    } finally {
      await new Promise<void>((r) => t.srv.close(() => r()));
    }
  });

  it("/answer finishing before tailoring is held and merged when tailoring finishes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const t = await serve("run-h", async () => {
      await gate;
      return tailorOutput("run-h", [q1]);
    });
    try {
      const tj = await t.post("/tailor", tailorBody);
      const aj = await t.post("/answer", { ...answerBody, tailorJobId: tj });
      expect(await t.wait(`/answer/${aj}`)).toMatchObject({ status: "done" });
      expect(t.state().answers).toEqual({});
      release();
      await t.wait(`/tailor/${tj}`, (s: any) => s.result?.answers?.length === 1);
      expect(t.state().answers).toEqual({ q2: "Because" });
    } finally {
      await new Promise<void>((r) => t.srv.close(() => r()));
    }
  });

  it("/answer without tailorJobId behaves exactly as today", async () => {
    const t = await serve("run-n", async () => tailorOutput("run-n", [q1]));
    try {
      const aj = await t.post("/answer", answerBody);
      expect(await t.wait(`/answer/${aj}`)).toMatchObject({ status: "done", answers: [{ fieldId: "q2", value: "Because" }] });
      await new Promise((r) => setTimeout(r, 30));
      expect(t.state().answers).toEqual({});
      // Unknown tailorJobId: still a normal answer response, nothing written.
      const bj = await t.post("/answer", { ...answerBody, tailorJobId: "nope" });
      expect(await t.wait(`/answer/${bj}`)).toMatchObject({ status: "done" });
      await new Promise((r) => setTimeout(r, 30));
      expect(t.state().answers).toEqual({});
    } finally {
      await new Promise<void>((r) => t.srv.close(() => r()));
    }
  });
});
