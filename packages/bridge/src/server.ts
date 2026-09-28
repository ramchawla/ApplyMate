import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
} from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OutputStore } from "./store";
import type { Db } from "../../../lib/local/db";
import { persistOutput } from "./persist";
import { extractTechKeywords } from "../../../lib/shared/keywords";
import { parse as parseYaml } from "yaml";
import { JobQueue } from "./jobs";
import { markApplied } from "./persist";
import type { TailorJobResult } from "./tailor-job";
import type { TailorRequest } from "../../../lib/shared/types";

export interface ServerOptions {
  // When set, /output and /output/latest require `Authorization: Bearer <token>`.
  token?: string;
  // When set, each posted output is persisted to SQLite.
  db?: Db;
  // Override for tests; defaults to ~/.applymate/resume-master.tex.
  masterResumePath?: string;
  // One-click tailoring: runs behind an async job queue (MV3 service workers
  // can die during a single 60s fetch, so the extension polls instead).
  tailor?: (req: TailorRequest) => Promise<TailorJobResult>;
  // ~/.applymate/profile.yaml, served to the extension for instant fill.
  profilePath?: string;
  // Records the first extension origin that paired (trust on first use).
  pairFile?: string;
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

export function createServer(
  store: OutputStore,
  options: ServerOptions = {},
): Server {
  const jobs = options.tailor
    ? new JobQueue<TailorRequest, TailorJobResult>(options.tailor)
    : null;

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
    if (req.method === "GET" && url === "/pair") {
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
          return send(202, { jobId: jobs.enqueue(valid) });
        },
        (err: Error) => send(400, { error: err.message }),
      );
      return;
    }

    const jobMatch = url.match(/^\/tailor\/([\w-]+)(?:\/(resume|cover-letter)\.pdf)?$/);
    if (req.method === "GET" && jobMatch && jobs) {
      const job = jobs.get(jobMatch[1]);
      if (!job) return send(404, { error: "unknown job" });
      if (jobMatch[2]) {
        const bytes =
          jobMatch[2] === "resume" ? job.result?.resumePdf : job.result?.coverLetterPdf;
        if (!bytes) return send(404, { error: "pdf not ready" });
        res.writeHead(200, { "content-type": "application/pdf", ...cors });
        res.end(bytes);
        return;
      }
      return send(200, { status: job.status, error: job.error, result: job.result?.result });
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

    if (req.method === "GET" && url === "/output/latest") {
      return send(200, store.getLatest());
    }

    // Tech keywords found in the master resume — the extension diffs these
    // against the JD's keywords to show the coverage gap before tailoring.
    if (req.method === "GET" && url === "/resume/keywords") {
      const path =
        options.masterResumePath ??
        join(homedir(), ".applymate", "resume-master.tex");
      try {
        const tex = readFileSync(path, "utf8");
        return send(200, { keywords: extractTechKeywords(tex) });
      } catch {
        return send(404, { error: "master resume not found", path });
      }
    }

    if (req.method === "POST" && url === "/output") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        try {
          const parsed = JSON.parse(raw || "{}");
          if (!parsed.jobUrl || typeof parsed.jobUrl !== "string") {
            return send(400, { error: "jobUrl is required" });
          }
          store.set(parsed);
          if (options.db) {
            try {
              persistOutput(options.db, parsed);
            } catch (err) {
              console.error("[ApplyMate] persist failed:", err);
            }
          }
          return send(200, { stored: true });
        } catch {
          return send(400, { error: "invalid JSON" });
        }
      });
      return;
    }

    return send(404, { error: "not found" });
  });
}
