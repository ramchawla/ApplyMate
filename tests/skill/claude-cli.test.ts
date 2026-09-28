import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  runClaude,
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
