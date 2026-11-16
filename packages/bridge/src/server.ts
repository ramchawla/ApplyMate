import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
} from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import type { Db } from "../../../lib/local/db";
import { parse as parseYaml } from "yaml";
import { JobQueue } from "./jobs";
import { markApplied } from "./persist";
import type { TailorJobResult } from "./tailor-job";
import type { ChatEvent, TailorQuestion, TailorRequest } from "../../../lib/shared/types";
import type { AnswerRequest, Answers } from "../../skill/src/tailor/answer";
import { BusyError, type Chat } from "./chat";

export interface ServerOptions {
  // When set, every route except /health and /pair requires
  // `Authorization: Bearer <token>`.
  token?: string;
  // When set, applied marks are persisted to SQLite.
  db?: Db;
  // One-click tailoring: runs behind an async job queue (MV3 service workers
  // can die during a single 60s fetch, so the extension polls instead).
  tailor?: (req: TailorRequest) => Promise<TailorJobResult>;
  // Answers-only call for later wizard steps; its own queue so it can run
  // while a tailoring job is still going.
  answer?: (req: AnswerRequest) => Promise<Answers>;
  // ~/.applymate/profile.yaml, served to the extension for instant fill.
  profilePath?: string;
  // Records the first extension origin that paired (trust on first use).
  pairFile?: string;
  // Per-run chat (side panel): streamed turns, apply/undo, run PDFs.
  chat?: Chat;
}

// Reflect CORS only for the extension origin. A localhost bridge holding the
// user's resume + PII must NOT use `Access-Control-Allow-Origin: *`, or any
// website the user visits could read their data. The extension side panel has
// host permissions and can fetch without CORS regardless.
function corsHeaders(origin: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    Vary: "Origin",
  };
  if (origin && origin.startsWith("chrome-extension://")) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

// Defeat DNS rebinding: the browser sends the attacker's hostname in Host even
// though it resolves to 127.0.0.1. Only accept loopback hostnames.
function hostAllowed(host: string | undefined): boolean {
  if (!host) return false;
  const hostname = host.split(":")[0];
  return hostname === "127.0.0.1" || hostname === "localhost";
}

const MAX_BODY = 1_000_000;

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
  });
}

const s = (v: unknown): string => (typeof v === "string" ? v : "");

export function validateTailorRequest(x: unknown): TailorRequest | string {
  const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const job = (r.job && typeof r.job === "object" ? r.job : null) as Record<
    string,
    unknown
  > | null;
  if (!job || !s(job.url)) return "job.url is required";
  const fields = (Array.isArray(r.fields) ? r.fields : [])
    .filter(
      (f): f is Record<string, unknown> =>
        !!f && typeof f === "object" && !!s((f as Record<string, unknown>).fieldId),
    )
    .slice(0, 60)
    .map((f) => ({
      fieldId: s(f.fieldId),
      label: s(f.label).slice(0, 500),
      type: s(f.type) || "text",
      options: Array.isArray(f.options)
        ? f.options.filter((o): o is string => typeof o === "string").slice(0, 200)
        : undefined,
      required: f.required === true,
    }));
  return {
    job: {
      title: s(job.title),
      company: s(job.company),
      url: s(job.url),
      description: s(job.description).slice(0, 30_000),
    },
    keywords: (Array.isArray(r.keywords) ? r.keywords : [])
      .filter((k): k is string => typeof k === "string")
      .map((k) => k.trim())
      .filter(Boolean)
      .slice(0, 30),
    fields,
    wantCoverLetterPdf: r.wantCoverLetterPdf === true,
  };
}

export function createServer(options: ServerOptions = {}): Server {
  const jobs = options.tailor
    ? new JobQueue<TailorRequest, TailorJobResult>(options.tailor)
    : null;
  const answerJobs = options.answer
    ? new JobQueue<AnswerRequest, Answers>(options.answer)
    : null;

  const chat = options.chat;
  type Answered = { fieldId: string; value: string }[];
  // Wizard answers that finished before their tailoring job did, keyed by tailor job id.
  const held = new Map<string, { questions: TailorQuestion[]; answers: Answered }[]>();

  // Done tailor job -> its run id (and remembered in chat for later lookups).
  function runOf(tailorJobId: string): string | undefined {
    const job = jobs?.get(tailorJobId);
    const runId = job?.status === "done" ? job.result?.result.runId : undefined;
    if (runId && chat) chat.linkJob(tailorJobId, runId);
    return runId;
  }

  // Never throws: a failed merge must not touch the /answer response.
  function merge(runId: string, h: { questions: TailorQuestion[]; answers: Answered }) {
    chat?.mergeAnswers(runId, h.questions, h.answers).catch((err: Error) =>
      console.error(`[ApplyMate] merging answers into ${runId} failed: ${err.message}`),
    );
  }

  // Run once a tailor job has settled: link it, then drain answers held for it.
  function settled(tailorJobId: string) {
    const runId = runOf(tailorJobId);
    const batches = held.get(tailorJobId) ?? [];
    held.delete(tailorJobId);
    if (runId) batches.forEach((h) => merge(runId, h));
  }

  // The run's current state laid over the tailoring result; unreadable -> original result.
  function current(runId: string | undefined, result: TailorJobResult["result"] | undefined) {
    const state = runId && result ? chat?.get(runId)?.state : undefined;
    if (!result || !state) return result;
    return {
      ...result,
      coverLetter: state.coverLetter,
      answers: Object.entries(state.answers).map(([fieldId, value]) => ({ fieldId, value })),
      questions: state.questions,
      version: state.version,
    };
  }

  return createHttpServer((req, res) => {
    const url = req.url ?? "/";
    const cors = corsHeaders(req.headers.origin);
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json", ...cors });
      res.end(JSON.stringify(body));
    };

    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    if (!hostAllowed(req.headers.host)) {
      return send(403, { error: "forbidden host" });
    }

    if (req.method === "GET" && url === "/health") {
      return send(200, { ok: true });
    }

    // Pairing hands the token to the extension so the user never pastes it.
    // Only chrome-extension:// origins (web pages can't forge Origin), and
    // only the first one to ask — later origins are refused.
    if (req.method === "POST" && url === "/pair") {
      const origin = req.headers.origin ?? "";
      if (!options.token || !options.pairFile || !origin.startsWith("chrome-extension://")) {
        return send(403, { error: "pairing unavailable" });
      }
      let paired = "";
      try {
        paired = readFileSync(options.pairFile, "utf8").trim();
      } catch {
        /* first pairing */
      }
      if (paired && paired !== origin) {
        return send(403, {
          error: "bridge is paired with another extension — run `pnpm bridge:unpair`",
        });
      }
      if (!paired) writeFileSync(options.pairFile, origin, { mode: 0o600 });
      return send(200, { token: options.token });
    }

    // Protected routes require the bearer token when one is configured.
    if (options.token) {
      const auth = req.headers.authorization ?? "";
      if (auth !== `Bearer ${options.token}`) {
        return send(401, { error: "unauthorized" });
      }
    }

    if (req.method === "POST" && url === "/tailor") {
      if (!jobs) return send(503, { error: "tailoring not configured" });
      readJson(req).then(
        (parsed) => {
          const valid = validateTailorRequest(parsed);
          if (typeof valid === "string") return send(400, { error: valid });
          const jobId = jobs.enqueue(valid);
          // idle() resolves after this job (and any before it) has settled.
          jobs.idle().then(() => settled(jobId));
          return send(202, { jobId });
        },
        (err: Error) => send(400, { error: err.message }),
      );
      return;
    }

    const jobMatch = url.match(/^\/tailor\/([\w-]+)(?:\/(resume|cover-letter)\.pdf)?$/);
    if (req.method === "GET" && jobMatch && jobs) {
      const job = jobs.get(jobMatch[1]);
      if (!job) return send(404, { error: "unknown job" });
      const runId = runOf(jobMatch[1]);
      const overlaid = current(runId, job.result?.result);
      if (jobMatch[2]) {
        const kind = jobMatch[2] as "resume" | "cover-letter";
        // Once a chat apply has changed the run, its folder holds the latest files.
        const latest = runId && overlaid && overlaid.version > 0 ? chat?.pdf(runId, kind) : null;
        const bytes = latest ?? (kind === "resume" ? job.result?.resumePdf : job.result?.coverLetterPdf);
        if (!bytes) return send(404, { error: "pdf not ready" });
        res.writeHead(200, { "content-type": "application/pdf", ...cors });
        res.end(bytes);
        return;
      }
      return send(200, { status: job.status, error: job.error, result: overlaid });
    }

    if (req.method === "POST" && url === "/answer") {
      if (!answerJobs) return send(503, { error: "answering not configured" });
      readJson(req).then(
        (parsed) => {
          const valid = validateTailorRequest(parsed);
          if (typeof valid === "string") return send(400, { error: valid });
          const jobId = answerJobs.enqueue({ job: valid.job, fields: valid.fields });
          const tailorJobId = s((parsed as Record<string, unknown>).tailorJobId);
          if (tailorJobId && chat && jobs) {
            answerJobs.idle().then(() => {
              const answers = answerJobs.get(jobId)?.result?.answers;
              const tj = jobs.get(tailorJobId);
              // Failed answer job, or a tailor job that's unknown/failed: nothing to merge.
              if (!answers?.length || !tj || tj.status === "error") return;
              const h = { questions: valid.fields, answers };
              const runId = runOf(tailorJobId);
              if (runId) merge(runId, h);
              else if (tj.status !== "done") held.set(tailorJobId, [...(held.get(tailorJobId) ?? []), h]);
            });
          }
          return send(202, { jobId });
        },
        (err: Error) => send(400, { error: err.message }),
      );
      return;
    }

    const answerMatch = url.match(/^\/answer\/([\w-]+)$/);
    if (req.method === "GET" && answerMatch && answerJobs) {
      const job = answerJobs.get(answerMatch[1]);
      if (!job) return send(404, { error: "unknown job" });
      return send(200, { status: job.status, error: job.error, answers: job.result?.answers });
    }

    if (req.method === "GET" && url === "/profile") {
      if (!options.profilePath) return send(404, { error: "no profile configured" });
      try {
        return send(200, parseYaml(readFileSync(options.profilePath, "utf8")) ?? {});
      } catch {
        return send(404, {
          error: "profile not found — run `pnpm profile:init`",
          path: options.profilePath,
        });
      }
    }

    if (req.method === "POST" && url === "/applications/applied") {
      readJson(req).then(
        (parsed) => {
          const p = (parsed ?? {}) as Record<string, unknown>;
          if (!s(p.jobUrl)) return send(400, { error: "jobUrl is required" });
          const applicationId = options.db
            ? markApplied(options.db, {
                jobUrl: s(p.jobUrl),
                company: s(p.company),
                jobTitle: s(p.jobTitle),
              })
            : null;
          return send(200, { applicationId });
        },
        (err: Error) => send(400, { error: err.message }),
      );
      return;
    }

    const chatMatch = url.match(/^\/chat\/([\w-]+)(?:\/(apply|resume\.pdf|cover-letter\.pdf))?$/);
    if (chatMatch && chat) {
      const [, runId, sub] = chatMatch;
      if (!chat.has(runId)) return send(404, { error: "unknown run" });
      const fail = (err: Error) => send(500, { error: err.message });

      if (req.method === "GET" && !sub) {
        const run = chat.get(runId);
        return run ? send(200, run) : send(500, { error: "run files unreadable (see bridge.log)" });
      }

      if (req.method === "GET" && sub?.endsWith(".pdf")) {
        const bytes = chat.pdf(runId, sub === "resume.pdf" ? "resume" : "cover-letter");
        if (!bytes) return send(404, { error: "pdf not found" });
        res.writeHead(200, { "content-type": "application/pdf", ...cors });
        res.end(bytes);
        return;
      }

      if (req.method === "POST" && sub === "apply") {
        readJson(req).then((parsed) => {
          const p = (parsed ?? {}) as Record<string, unknown>;
          const idx = (v: unknown) => Number.isInteger(v) && (v as number) >= 0;
          if (!idx(p.messageIndex) || !idx(p.proposalIndex)) {
            return send(400, { error: "messageIndex and proposalIndex are required" });
          }
          return chat
            .apply(runId, {
              messageIndex: p.messageIndex as number,
              proposalIndex: p.proposalIndex as number,
              undo: p.undo === true,
            })
            .then((r) => send(r.ok ? 200 : 409, r), fail);
        }, (err: Error) => send(400, { error: err.message }));
        return;
      }

      if (req.method === "POST" && !sub) {
        readJson(req).then((parsed) => {
          const message = s((parsed as Record<string, unknown> | null)?.message).trim();
          if (!message) return send(400, { error: "message is required" });
          // Headers go out with the first event, so busy/unreadable can still be a status code.
          // A client that disconnects mid-turn stops getting lines; the turn still finishes
          // so chat.json stays whole.
          let started = false;
          const write = (e: ChatEvent) => {
            if (!started) {
              res.writeHead(200, { "content-type": "application/x-ndjson", ...cors });
              started = true;
            }
            if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify(e) + "\n");
          };
          chat.send(runId, message, write).then(
            () => started && res.end(),
            (err: Error) => {
              if (!started) {
                return err instanceof BusyError ? send(409, { error: "busy" }) : fail(err);
              }
              write({ t: "error", message: err.message });
              res.end();
            },
          );
        }, (err: Error) => send(400, { error: err.message }));
        return;
      }
    }

    return send(404, { error: "not found" });
  });
}
