import { createServer as createHttpServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { OutputStore } from "./store";
import type { Db } from "../../../lib/local/db";
import { persistOutput } from "./persist";
import { extractTechKeywords } from "../../../lib/shared/keywords";

export interface ServerOptions {
  // When set, /output and /output/latest require `Authorization: Bearer <token>`.
  token?: string;
  // When set, each posted output is persisted to SQLite.
  db?: Db;
  // Override for tests; defaults to ~/.applymate/resume-master.tex.
  masterResumePath?: string;
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

export function createServer(
  store: OutputStore,
  options: ServerOptions = {},
): Server {
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

    // Protected routes require the bearer token when one is configured.
    if (options.token) {
      const auth = req.headers.authorization ?? "";
      if (auth !== `Bearer ${options.token}`) {
        return send(401, { error: "unauthorized" });
      }
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
