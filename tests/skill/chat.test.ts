import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseResume, partLabels } from "../../packages/skill/src/tailor/resume-doc";
import { CHAT_SYSTEM, CHAT_HISTORY_LIMIT, buildChatPrompt, splitReply } from "../../packages/skill/src/tailor/chat";
import type { ChatMessage, RunState } from "../../lib/shared/types";

const doc = parseResume(
  readFileSync(fileURLToPath(new URL("./fixtures/resume-master.tex", import.meta.url)), "utf8"),
);
const state: RunState = {
  edits: { summary: "EDITED SUMMARY" },
  order: {},
  coverLetter: "Dear Hiring Team, hi.",
  answers: { q2: "3-5" },
  questions: [
    { fieldId: "q1", label: "Why us?", type: "textarea", required: true },
    { fieldId: "q2", label: "Years of Python", type: "select", options: ["0-2", "3-5"], required: true },
  ],
  version: 1,
};
const msg: ChatMessage = { role: "user", text: "hello", at: 1 };
const ctx = {
  jd: "Build agents.",
  doc,
  labels: partLabels(doc),
  state,
  corpusYaml: "corpus: yes",
  profileYaml: "name: Ram",
  history: [] as ChatMessage[],
  message: "Make it shorter",
};

describe("CHAT_SYSTEM", () => {
  it("carries the guardrails", () => {
    expect(CHAT_SYSTEM).toMatch(/untrusted/i);
    expect(CHAT_SYSTEM).toMatch(/Never invent metrics, employers, titles/);
    expect(CHAT_SYSTEM).toContain("```proposals");
    expect(CHAT_SYSTEM).toMatch(/answer:<fieldId>/);
    expect(CHAT_SYSTEM).toMatch(/verbatim/);
    expect(CHAT_SYSTEM).toContain("\\% \\& \\$ \\# \\_");
  });
});

describe("buildChatPrompt", () => {
  const p = buildChatPrompt(ctx);
  it("orders sections and ends with the user message", () => {
    const order = ["# Job description", "# Current resume parts", "# Cover letter", "# Form answers", "# Experience corpus", "# Candidate profile", "# Conversation"].map((h) => p.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(p.trimEnd().endsWith(ctx.message)).toBe(true);
  });
  it("shows labels, budgets from master, current text", () => {
    expect(p).toContain("[r0.b0] Acme Corp · bullet 1 (max");
    const summaryMax = doc.parts.find((x) => x.id === "summary")!.text.length;
    expect(p).toContain(`[summary] Summary (max ${summaryMax} chars) EDITED SUMMARY`);
    expect(p).toContain(doc.parts.find((x) => x.id === "r0.b0")!.text);
  });
  it("lists questions with answer: ids, options and current answers", () => {
    expect(p).toContain("[answer:q1] Why us? (textarea; required) -> (empty)");
    expect(p).toContain("[answer:q2] Years of Python (select; required; options: 0-2 | 3-5) -> 3-5");
  });
  it("includes cover letter, corpus, profile", () => {
    expect(p).toContain("Dear Hiring Team, hi.");
    expect(p).toContain("corpus: yes");
    expect(p).toContain("name: Ram");
  });
  it("keeps only the last CHAT_HISTORY_LIMIT messages", () => {
    const h = Array.from({ length: 30 }, (_, i): ChatMessage => ({ role: "user", text: `m${i}`, at: i }));
    const q = buildChatPrompt({ ...ctx, history: h });
    expect(CHAT_HISTORY_LIMIT).toBe(20);
    expect(q.split("## User").length - 1).toBe(21);
    expect(q).toContain("m29");
    expect(q).not.toContain("m9\n");
    expect(q).toContain("m10\n");
    expect(buildChatPrompt({ ...ctx, history: [{ role: "assistant", text: "hey", at: 1 }] })).toContain("## You (coach)\nhey");
  });
});

describe("splitReply", () => {
  it("splits prose and proposals", () => {
    expect(splitReply('Hi.\n```proposals\n[{"target":"summary","after":"x","why":"y"}]\n```')).toEqual({
      reply: "Hi.",
      raw: [{ target: "summary", after: "x", why: "y" }],
    });
  });
  it("no block", () => {
    expect(splitReply("Just talk.")).toEqual({ reply: "Just talk.", raw: null });
  });
  it("bad json", () => {
    const r = splitReply("Hi.\n```proposals\n[{bad\n```");
    expect(r.parseError).toBeTruthy();
    expect(r.raw).toBeNull();
    expect(r.reply).toBe("Hi.");
  });
  it("non-array json is a parse error", () => {
    const r = splitReply('Hi.\n```proposals\n{"a":1}\n```');
    expect(r.parseError).toBeTruthy();
    expect(r.raw).toBeNull();
  });
  it("unclosed fence (stream cut) excludes the partial block", () => {
    const r = splitReply('Hi.\n```proposals\n[{"target":"sum');
    expect(r.parseError).toBeTruthy();
    expect(r.raw).toBeNull();
    expect(r.reply).toBe("Hi.");
  });
  it("uses the last proposals fence", () => {
    const r = splitReply('Example:\n```proposals\n[]\n```\nReal:\n```proposals\n[{"target":"a","after":"b","why":"c"}]\n```');
    expect(r.raw).toEqual([{ target: "a", after: "b", why: "c" }]);
    expect(r.reply).toContain("Example:");
  });
});
