import { spawn } from "node:child_process";

export interface ClaudeRunOptions {
  system: string;
  prompt: string;
  schema: object;
  model?: string;
  cwd?: string;
  timeoutMs?: number;
  bin?: string;
}

export type ClaudeRunner = (opts: ClaudeRunOptions) => Promise<unknown>;

// Headless Claude Code on the user's subscription — never the paid API.
// --bare is deliberately absent: it forces ANTHROPIC_API_KEY auth. Context is
// isolated instead: no tools, no user settings/hooks/MCP, no CLAUDE.md, so the
// user's global instructions (e.g. terse "caveman" style) can't leak into a
// cover letter.
export const runClaude: ClaudeRunner = (opts) =>
  new Promise((resolve, reject) => {
    const timeoutMs = opts.timeoutMs ?? 180_000;
    const args = [
      "-p",
      "--output-format", "json",
      "--model", opts.model ?? process.env.APPLYMATE_MODEL ?? "sonnet",
      "--tools", "",
      "--no-session-persistence",
      "--setting-sources", "project",
      "--strict-mcp-config",
      "--system-prompt", opts.system,
      "--json-schema", JSON.stringify(opts.schema),
    ];
    const child = spawn(opts.bin ?? process.env.APPLYMATE_CLAUDE_BIN ?? "claude", args, {
      cwd: opts.cwd,
      env: {
        ...process.env,
        CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

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
    child.stdin.on("error", () => {}); // EPIPE when the binary is missing/dies early
    child.on("error", (err: NodeJS.ErrnoException) =>
      finish(() =>
        reject(
          err.code === "ENOENT"
            ? new Error("claude CLI not found on PATH — install Claude Code and log in")
            : err,
        ),
      ),
    );
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
