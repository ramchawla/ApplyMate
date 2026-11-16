import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { request, type Server } from "node:http";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createServer,
  validateTailorRequest,
} from "../../packages/bridge/src/server";
import type { TailorRequest } from "../../lib/shared/types";
import { makeChat } from "../../packages/bridge/src/chat";
import { fakeCompile, setupRun, tailorOutput, LETTER_AFTER } from "./run-fixture";

const TOKEN = "t0ken";
const dir = mkdtempSync(join(tmpdir(), "am-routes-"));
const profilePath = join(dir, "profile.yaml");
const pairFile = join(dir, "paired-extension");
writeFileSync(profilePath, "name: {first: Jane}\nanswers: []\n");

let server: Server;
let port = 0;
const auth = { authorization: `Bearer ${TOKEN}` };
const body: TailorRequest = {
  job: { title: "SRE", company: "Acme", url: "https://x/1", description: "" },
  keywords: ["go"],
  fields: [],
  wantCoverLetterPdf: true,
};

function raw(
  path: string,
  headers: Record<string, string>,
  method = "POST",
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: { host: "127.0.0.1", ...headers },
      },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  server = createServer({
    token: TOKEN,
    profilePath,
    pairFile,
    tailor: async (req) => {
      if (req.job.company === "Boom") throw new Error("claude timed out after 180s");
      return {
        result: {
          applicationId: "app_1",
          fileName: "Jane_Dev.pdf",
          coverLetter: "Dear",
          hasCoverLetterPdf: true,
          answers: [],
          keywords: { present: [], injected: [], skipped: [] },
          edits: [],
          warnings: [],
          pages: 1,
          savedTo: "/tmp/x",
        },
        resumePdf: Buffer.from("%PDF-resume"),
        coverLetterPdf: Buffer.from("%PDF-letter"),
      };
    },
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  port = typeof addr === "object" && addr ? addr.port : 0;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const base = () => `http://127.0.0.1:${port}`;
async function waitDone(jobId: string) {
  for (let i = 0; i < 50; i++) {
    const s = await (await fetch(`${base()}/tailor/${jobId}`, { headers: auth })).json();
    if (s.status === "done" || s.status === "error") return s;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("job never finished");
}

describe("pairing", () => {
  it("refuses non-extension origins", async () => {
    expect((await raw("/pair", { origin: "https://evil.com" })).status).toBe(403);
  });
  it("hands the token to the first extension and locks to it", async () => {
    const first = await raw("/pair", { origin: "chrome-extension://abc" });
    expect(first.status).toBe(200);
    expect(JSON.parse(first.body).token).toBe(TOKEN);
    expect(readFileSync(pairFile, "utf8")).toBe("chrome-extension://abc");
    expect((await raw("/pair", { origin: "chrome-extension://abc" })).status).toBe(200);
    expect((await raw("/pair", { origin: "chrome-extension://other" })).status).toBe(403);
  });
});

describe("tailor routes", () => {
  it("requires the token", async () => {
    const res = await fetch(`${base()}/tailor`, { method: "POST", body: JSON.stringify(body) });
    expect(res.status).toBe(401);
  });

  it("rejects malformed requests", async () => {
    const res = await fetch(`${base()}/tailor`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ job: 1 }),
    });
    expect(res.status).toBe(400);
  });

  it("queues a job, reports the result, and serves both PDFs", async () => {
    const res = await fetch(`${base()}/tailor`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(202);
    const { jobId } = await res.json();
    const done = await waitDone(jobId);
    expect(done.result.fileName).toBe("Jane_Dev.pdf");
    expect(done.result.resumePdf).toBeUndefined();
    const pdf = await fetch(`${base()}/tailor/${jobId}/resume.pdf`, { headers: auth });
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).toString()).toBe("%PDF-resume");
    const letter = await fetch(`${base()}/tailor/${jobId}/cover-letter.pdf`, {
      headers: auth,
    });
    expect(Buffer.from(await letter.arrayBuffer()).toString()).toBe("%PDF-letter");
  });

  it("surfaces job errors", async () => {
    const res = await fetch(`${base()}/tailor`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ ...body, job: { ...body.job, company: "Boom" } }),
    });
    const done = await waitDone((await res.json()).jobId);
    expect(done).toMatchObject({ status: "error", error: "claude timed out after 180s" });
  });

  it("404s unknown jobs", async () => {
    expect((await fetch(`${base()}/tailor/nope`, { headers: auth })).status).toBe(404);
  });
});

describe("profile + applied", () => {
  it("serves the parsed profile", async () => {
    const p = await (await fetch(`${base()}/profile`, { headers: auth })).json();
    expect(p.name.first).toBe("Jane");
  });
  it("accepts an applied mark", async () => {
    const res = await fetch(`${base()}/applications/applied`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ jobUrl: "https://x/1", company: "Acme", jobTitle: "SRE" }),
    });
    expect(res.status).toBe(200);
  });
});

describe("validateTailorRequest", () => {
  it("normalizes keywords and fields", () => {
    const v = validateTailorRequest({
      job: { title: "T", company: "C", url: "u" },
      keywords: [" go ", "", 3],
      fields: [{ fieldId: "a", label: "A", type: "text", required: true }, { nope: 1 }],
    });
    expect(typeof v).toBe("object");
    if (typeof v === "object") {
      expect(v.job.description).toBe("");
      expect(v.keywords).toEqual(["go"]);
      expect(v.fields).toHaveLength(1);
      expect(v.wantCoverLetterPdf).toBe(false);
    }
  });
  it("rejects a missing job url", () => {
    expect(validateTailorRequest({ job: { title: "T" } })).toMatch(/job\.url/);
  });
});

describe("tailor routes serve current run state", () => {
  it("after a chat apply, /tailor/:id returns the new cover letter and version 1, and resume.pdf returns the new bytes", async () => {
    for (const [runId, proposalIndex] of [["run-a", 0], ["run-b", 1]] as const) {
      const chat = makeChat({ ...(await setupRun(runId)), compile: fakeCompile });
      const srv = createServer({ token: TOKEN, chat, tailor: async () => tailorOutput(runId) });
      await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
      const addr = srv.address();
      const url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
      try {
        const { jobId } = await (await fetch(`${url}/tailor`, { method: "POST", headers: auth, body: JSON.stringify(body) })).json();
        for (let i = 0; i < 50; i++) {
          const s = await (await fetch(`${url}/tailor/${jobId}`, { headers: auth })).json();
          if (s.status === "done") break;
          await new Promise((r) => setTimeout(r, 10));
        }
        // Version 0: today's result and bytes, untouched.
        const v0 = await (await fetch(`${url}/tailor/${jobId}`, { headers: auth })).json();
        expect(v0.result).toMatchObject({ version: 0, coverLetter: "Dear, old." });
        const pdf0 = await fetch(`${url}/tailor/${jobId}/resume.pdf`, { headers: auth });
        expect(Buffer.from(await pdf0.arrayBuffer()).toString()).toBe("%PDF-resume");

        expect((await chat.apply(runId, { messageIndex: 0, proposalIndex })).ok).toBe(true);

        const v1 = await (await fetch(`${url}/tailor/${jobId}`, { headers: auth })).json();
        expect(v1.result.version).toBe(1);
        expect(v1.result.answers).toEqual([]);
        if (proposalIndex === 1) expect(v1.result.coverLetter).toBe(LETTER_AFTER);
        else {
          const pdf = await fetch(`${url}/tailor/${jobId}/resume.pdf`, { headers: auth });
          expect(Buffer.from(await pdf.arrayBuffer()).toString()).toMatch(/^%PDF-new-/);
        }
      } finally {
        await new Promise<void>((r) => srv.close(() => r()));
      }
    }
  });
});
