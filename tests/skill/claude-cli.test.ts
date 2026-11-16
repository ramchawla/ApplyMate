import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  runClaude,
  streamClaude,
  parseClaudeOutput,
} from "../../packages/skill/src/tailor/claude-cli";

const FAKE = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));

beforeAll(() => chmodSync(FAKE, 0o755));
afterEach(() => {
  delete process.env.FAKE_CLAUDE_MODE;
});

describe("runClaude", () => {
  it("sends the prompt on stdin, isolates context, and returns structured output", async () => {
    const out = (await runClaude({
      bin: FAKE,
      system: "SYS",
      prompt: "hello",
      schema: { type: "object" },
    })) as { args: string[]; input: string; noClaudeMd: string };
    expect(out.input).toBe("hello");
    const arg = (flag: string) => out.args[out.args.indexOf(flag) + 1];
    expect(arg("--system-prompt")).toBe("SYS");
    expect(arg("--tools")).toBe("");
    expect(arg("--json-schema")).toBe('{"type":"object"}');
    expect(arg("--setting-sources")).toBe("project");
    expect(out.args).toContain("--no-session-persistence");
    expect(out.args).not.toContain("--bare");
    expect(out.noClaudeMd).toBe("1");
    expect(arg("--effort")).toBe("low");
  });

  it("lets APPLYMATE_EFFORT override the effort level", async () => {
    process.env.APPLYMATE_EFFORT = "high";
    try {
      const out = (await runClaude({ bin: FAKE, system: "s", prompt: "p", schema: {} })) as {
        args: string[];
      };
      expect(out.args[out.args.indexOf("--effort") + 1]).toBe("high");
    } finally {
      delete process.env.APPLYMATE_EFFORT;
    }
  });

  it("rejects when claude reports an error", async () => {
    process.env.FAKE_CLAUDE_MODE = "error";
    await expect(
      runClaude({ bin: FAKE, system: "s", prompt: "p", schema: {} }),
    ).rejects.toThrow(/boom/);
  });

  it("rejects on timeout", async () => {
    process.env.FAKE_CLAUDE_MODE = "hang";
    await expect(
      runClaude({ bin: FAKE, system: "s", prompt: "p", schema: {}, timeoutMs: 300 }),
    ).rejects.toThrow(/timed out/);
  });

  it("rejects clearly when the binary is missing", async () => {
    await expect(
      runClaude({ bin: "/nonexistent/claude", system: "s", prompt: "p", schema: {} }),
    ).rejects.toThrow(/not found/);
  });
});

describe("streamClaude", () => {
  afterEach(() => {
    delete process.env.FAKE_CLAUDE_ECHO;
  });
  const base = { bin: FAKE, system: "SYS", prompt: "p" };

  it("streams deltas and resolves the concatenated text", async () => {
    process.env.FAKE_CLAUDE_MODE = "stream";
    const deltas: string[] = [];
    expect(await streamClaude({ ...base, onDelta: (t) => deltas.push(t) })).toBe("Hello");
    expect(deltas).toEqual(["Hel", "lo"]);
  });

  it("uses stream flags and keeps isolation, no schema, no --bare", async () => {
    process.env.FAKE_CLAUDE_MODE = "stream";
    process.env.FAKE_CLAUDE_ECHO = "1";
    const text = await streamClaude({ ...base, onDelta: () => {} });
    const echo = JSON.parse(text.slice("Hello".length)) as { args: string[]; noClaudeMd: string };
    const arg = (flag: string) => echo.args[echo.args.indexOf(flag) + 1];
    expect(arg("--output-format")).toBe("stream-json");
    expect(echo.args).toContain("--verbose");
    expect(echo.args).toContain("--include-partial-messages");
    expect(arg("--system-prompt")).toBe("SYS");
    expect(arg("--tools")).toBe("");
    expect(arg("--setting-sources")).toBe("project");
    expect(arg("--model")).toBe("sonnet");
    expect(arg("--effort")).toBe("low");
    expect(echo.args).toContain("--no-session-persistence");
    expect(echo.args).toContain("--strict-mcp-config");
    expect(echo.args).not.toContain("--json-schema");
    expect(echo.args).not.toContain("--bare");
    expect(echo.noClaudeMd).toBe("1");
  });

  it("rejects when the result line is an error", async () => {
    process.env.FAKE_CLAUDE_MODE = "stream-error";
    await expect(streamClaude({ ...base, onDelta: () => {} })).rejects.toThrow(/usage limit/);
  });

  it("resolves the text when the result line is missing but exit is 0", async () => {
    process.env.FAKE_CLAUDE_MODE = "stream-noresult";
    expect(await streamClaude({ ...base, onDelta: () => {} })).toBe("Hello");
  });

  it("rejects with stderr tail on non-zero exit and no text", async () => {
    process.env.FAKE_CLAUDE_MODE = "stream-fail";
    await expect(streamClaude({ ...base, onDelta: () => {} })).rejects.toThrow(/exit 1.*kaput/);
  });

  it("rejects on timeout", async () => {
    process.env.FAKE_CLAUDE_MODE = "hang";
    await expect(
      streamClaude({ ...base, onDelta: () => {}, timeoutMs: 300 }),
    ).rejects.toThrow(/timed out/);
  });

  it("rejects clearly when the binary is missing", async () => {
    await expect(
      streamClaude({ ...base, bin: "/nonexistent/claude", onDelta: () => {} }),
    ).rejects.toThrow(/not found/);
  });
});

describe("parseClaudeOutput", () => {
  it("falls back to a fenced JSON result string", () => {
    expect(
      parseClaudeOutput(JSON.stringify({ result: '```json\n{"a":1}\n```' })),
    ).toEqual({ a: 1 });
  });
  it("rejects non-JSON stdout", () => {
    expect(() => parseClaudeOutput("nope")).toThrow(/non-JSON/);
  });
});
