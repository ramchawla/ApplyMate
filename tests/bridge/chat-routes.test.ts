import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "../../packages/bridge/src/server";
import { makeChat } from "../../packages/bridge/src/chat";
import { writeRun } from "../../lib/local/runs";
import { parseResume, partLabels } from "../../packages/skill/src/tailor/resume-doc";
import type { ChatEvent } from "../../lib/shared/types";

const TOKEN = "t0ken";
const auth = { authorization: `Bearer ${TOKEN}` };
const masterTex = readFileSync(
  fileURLToPath(new URL("../skill/fixtures/resume-master.tex", import.meta.url)),
  "utf8",
);
const dir = mkdtempSync(join(tmpdir(), "am-chat-routes-"));
const appsDir = join(dir, "applications");
const runDir = join(appsDir, "2026-11-16-acme-sre");

// The stream waits on `gate` when set, so a test can hold a turn open.
let gate: Promise<void> | null = null;
let replyText = "";

let server: Server;
let port = 0;
const base = () => `http://127.0.0.1:${port}`;

beforeAll(async () => {
  writeFileSync(join(dir, "profile.yaml"), "name: {first: Jane, last: Dev}\n");
  await writeRun(runDir, {
    report: {
      applicationId: "app_1",
      runId: "run-1",
      createdAt: "2026-11-16T10:00:00.000Z",
      job: { title: "SRE", company: "Acme", url: "https://x/1" },
      fileName: "Jane_Dev_Acme_SRE.pdf",
      wantCoverLetterPdf: false,
      labels: partLabels(parseResume(masterTex)),
      questions: [],
      keywords: { present: [], injected: [], skipped: [] },
      edits: [],
      warnings: [],
      pages: 1,
    },
    state: { edits: {}, order: {}, coverLetter: "Dear", answers: {}, questions: [], version: 0 },
    masterTex,
    resumeTex: masterTex,
    resumePdf: Buffer.from("%PDF-orig"),
    coverLetter: "Dear",
    jd: "JD",
  });
  const chat = makeChat({
    appsDir,
    dir,
    stream: async (o) => {
      o.onDelta(replyText.slice(0, 5));
      if (gate) await gate;
      o.onDelta(replyText.slice(5));
      return replyText;
    },
    compile: async (tex) => ({
      pdf: Buffer.from(`%PDF-${tex.length}`),
      pages: 1,
      height: tex.includes("LONGLONG") ? 800 : 700,
      goal: 0,
    }),
  });
  server = createServer({ token: TOKEN, chat });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  port = typeof addr === "object" && addr ? addr.port : 0;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const post = (path: string, body: unknown) =>
  fetch(`${base()}${path}`, { method: "POST", headers: auth, body: JSON.stringify(body) });

const events = (text: string): ChatEvent[] =>
  text.trim().split("\n").map((l) => JSON.parse(l));

describe("chat routes", () => {
  it("require the token", async () => {
    expect((await fetch(`${base()}/chat/run-1`)).status).toBe(401);
    expect((await fetch(`${base()}/chat/run-1`, { method: "POST", body: "{}" })).status).toBe(401);
  });

  it("404 for an unknown run, 400 for an empty message", async () => {
    expect((await fetch(`${base()}/chat/nope`, { headers: auth })).status).toBe(404);
    expect((await post("/chat/nope", { message: "hi" })).status).toBe(404);
    expect((await post("/chat/run-1", { message: "  " })).status).toBe(400);
  });

  it("streams NDJSON events ending in done, then GET shows the chat", async () => {
    replyText =
      'Tighter summary.\n\n```proposals\n[{"target":"summary","after":"Reliability engineer.","why":"w"},' +
      '{"target":"r0.b0","after":"LONGLONG bullet","why":"w"}]\n```';
    const res = await post("/chat/run-1", { message: "fix the summary" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    const evs = events(await res.text());
    expect(evs.slice(0, -1).every((e) => e.t === "delta")).toBe(true);
    const done = evs.at(-1)!;
    expect(done.t).toBe("done");
    expect(done.t === "done" && done.message.proposals?.length).toBe(2);

    const got = await (await fetch(`${base()}/chat/run-1`, { headers: auth })).json();
    expect(got.chat).toHaveLength(2);
    expect(got.state.version).toBe(0);
    expect(got.report.runId).toBe("run-1");
  });

  it("a concurrent POST gets 409 busy", async () => {
    replyText = "Just talk.";
    let open!: () => void;
    gate = new Promise((r) => (open = r));
    const first = post("/chat/run-1", { message: "one" });
    await new Promise((r) => setTimeout(r, 30));
    const second = await post("/chat/run-1", { message: "two" });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "busy" });
    open();
    gate = null;
    expect(events(await (await first).text()).at(-1)!.t).toBe("done");
  });

  it("apply: ok → 200 with the new version, doesn't fit → 409 with a reason", async () => {
    const tooLong = await post("/chat/run-1/apply", { messageIndex: 1, proposalIndex: 1 });
    expect(tooLong.status).toBe(409);
    expect(await tooLong.json()).toEqual({ ok: false, reason: "8 lines too long" });

    const ok = await post("/chat/run-1/apply", { messageIndex: 1, proposalIndex: 0 });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, version: 1 });

    expect((await post("/chat/run-1/apply", { messageIndex: "x", proposalIndex: 0 })).status).toBe(400);
  });

  it("serves the run's resume.pdf; cover-letter.pdf 404s until one exists", async () => {
    const pdf = await fetch(`${base()}/chat/run-1/resume.pdf`, { headers: auth });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).toString()).toBe(
      readFileSync(join(runDir, "resume.pdf"), "utf8"),
    );
    expect((await fetch(`${base()}/chat/run-1/cover-letter.pdf`, { headers: auth })).status).toBe(404);
  });

  it("a client that disconnects mid-turn doesn't stop the turn being saved", async () => {
    replyText = "Finished anyway.";
    let open!: () => void;
    gate = new Promise((r) => (open = r));
    const ctl = new AbortController();
    const res = await fetch(`${base()}/chat/run-1`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ message: "bye" }),
      signal: ctl.signal,
    });
    expect(res.status).toBe(200);
    ctl.abort();
    await new Promise((r) => setTimeout(r, 30));
    open();
    gate = null;
    for (let i = 0; i < 50; i++) {
      const chat = JSON.parse(readFileSync(join(runDir, "chat.json"), "utf8"));
      if (chat.at(-1)?.text === "Finished anyway.") return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("turn was not saved");
  });

  it("corrupt run files → 500 with an error, bridge keeps serving", async () => {
    writeFileSync(join(runDir, "chat.json"), "{broken");
    const res = await fetch(`${base()}/chat/run-1`, { headers: auth });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBeTruthy();
    const send = await post("/chat/run-1", { message: "hi" });
    expect(send.status).toBe(500);
    expect((await send.json()).error).toMatch(/unreadable/);
    const apply = await post("/chat/run-1/apply", { messageIndex: 1, proposalIndex: 0 });
    expect(apply.status).toBe(500);
    expect((await fetch(`${base()}/chat/nope`, { headers: auth })).status).toBe(404);
  });
});
