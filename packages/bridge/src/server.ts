import { createServer as createHttpServer, type Server } from "node:http";
import type { OutputStore } from "./store";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

export function createServer(store: OutputStore): Server {
  return createHttpServer((req, res) => {
    const url = req.url ?? "/";
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json", ...CORS });
      res.end(JSON.stringify(body));
    };

    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    if (req.method === "GET" && url === "/health") {
      return send(200, { ok: true });
    }

    if (req.method === "GET" && url === "/output/latest") {
      return send(200, store.getLatest());
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
