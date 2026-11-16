import { spawn } from "node:child_process";

export interface ClaudeRunOptions {
  system: string;
  prompt: string;
  schema: object;
  model?: string;
  effort?: string;
  cwd?: string;
  timeoutMs?: number;
  bin?: string;
}

export type ClaudeRunner = (opts: ClaudeRunOptions) => Promise<unknown>;

interface BaseOptions {
  system: string;
  model?: string;
  effort?: string;
  cwd?: string;
  bin?: string;
}

// Shared by every spawn: model/effort defaults + the context-isolation flags.
function baseArgs(opts: BaseOptions, format: string[]): string[] {
  return [
    "-p",
    ...format,
    "--model", opts.model ?? process.env.APPLYMATE_MODEL ?? "sonnet",
    // Low effort keeps a tailoring run near a minute; bump for quality.
    "--effort", opts.effort ?? process.env.APPLYMATE_EFFORT ?? "low",
    "--tools", "",
    "--no-session-persistence",
    "--setting-sources", "project",
    "--strict-mcp-config",
    "--system-prompt", opts.system,
  ];
}

function spawnClaude(opts: BaseOptions, args: string[]) {
  const child = spawn(opts.bin ?? process.env.APPLYMATE_CLAUDE_BIN ?? "claude", args, {
    cwd: opts.cwd,
    env: {
      ...process.env,
      CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdin.on("error", () => {}); // EPIPE when the binary is missing/dies early
  return child;
}

const missingBin = (err: NodeJS.ErrnoException) =>
  err.code === "ENOENT"
    ? new Error("claude CLI not found on PATH — install Claude Code and log in")
    : err;

// Headless Claude Code on the user's subscription — never the paid API.
// --bare is deliberately absent: it forces ANTHROPIC_API_KEY auth. Context is
// isolated instead: no tools, no user settings/hooks/MCP, no CLAUDE.md, so the
// user's global instructions (e.g. terse "caveman" style) can't leak into a
// cover letter.
export const runClaude: ClaudeRunner = (opts) =>
  new Promise((resolve, reject) => {
    const timeoutMs = opts.timeoutMs ?? 180_000;
    const child = spawnClaude(opts, [
      ...baseArgs(opts, ["--output-format", "json"]),
      "--json-schema", JSON.stringify(opts.schema),
    ]);

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() =>
        reject(new Error(`claude timed out after ${Math.round(timeoutMs / 1000)}s`)),
      );
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err: NodeJS.ErrnoException) => finish(() => reject(missingBin(err))));
    child.on("close", (code) =>
      finish(() => {
        try {
          resolve(parseClaudeOutput(stdout));
        } catch (err) {
          const detail = stderr.trim() ? `: ${stderr.trim().slice(-400)}` : "";
          reject(
            new Error(`${(err as Error).message}${code ? ` (exit ${code})` : ""}${detail}`),
          );
        }
      }),
    );
    child.stdin.end(opts.prompt);
  });

export interface StreamOptions extends BaseOptions {
  prompt: string;
  onDelta: (text: string) => void;
  timeoutMs?: number;
}

export type StreamRunner = (opts: StreamOptions) => Promise<string>;

// Same isolation as runClaude, but stream-json so chat text shows as it's
// generated. Text arrives as stream_event text_delta lines; the final `result`
// line carries is_error. No --json-schema (free prose out).
export const streamClaude: StreamRunner = (opts) =>
  new Promise((resolve, reject) => {
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const child = spawnClaude(
      opts,
      baseArgs(opts, [
        "--output-format", "stream-json", "--verbose", "--include-partial-messages",
      ]),
    );

    let buf = "";
    let text = "";
    let stderr = "";
    let failure: string | undefined;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() =>
        reject(new Error(`claude timed out after ${Math.round(timeoutMs / 1000)}s`)),
      );
    }, timeoutMs);

    const onLine = (line: string) => {
      let ev: {
        type?: string;
        is_error?: boolean;
        result?: unknown;
        subtype?: string;
        event?: { delta?: { type?: string; text?: string } };
      };
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev.type === "stream_event") {
        const d = ev.event?.delta;
        if (d?.type === "text_delta" && d.text) {
          text += d.text;
          opts.onDelta(d.text);
        }
      } else if (ev.type === "result" && ev.is_error) {
        failure = `claude error: ${String(ev.result ?? ev.subtype ?? "unknown")}`;
      }
    };

    child.stdout.on("data", (d) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        onLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err: NodeJS.ErrnoException) => finish(() => reject(missingBin(err))));
    child.on("close", (code) => {
      if (buf.trim()) onLine(buf); // last line without trailing newline
      finish(() => {
        if (failure) return reject(new Error(failure));
        if (code) {
          const detail = stderr.trim() ? `: ${stderr.trim().slice(-400)}` : "";
          return reject(new Error(`claude produced no output (exit ${code})${detail}`));
        }
        if (!text) return reject(new Error("claude returned no text"));
        resolve(text);
      });
    });
    child.stdin.end(opts.prompt);
  });

export function parseClaudeOutput(stdout: string): unknown {
  let d: { is_error?: boolean; result?: unknown; structured_output?: unknown; subtype?: string };
  try {
    d = JSON.parse(stdout);
  } catch {
    throw new Error("claude returned non-JSON output");
  }
  if (d.is_error) throw new Error(`claude error: ${String(d.result ?? d.subtype ?? "unknown")}`);
  if (d.structured_output !== undefined) return d.structured_output;
  if (typeof d.result === "string") {
    const body = d.result.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try {
      return JSON.parse(body);
    } catch {
      throw new Error("claude result was not valid JSON");
    }
  }
  throw new Error("claude output had no structured result");
}
