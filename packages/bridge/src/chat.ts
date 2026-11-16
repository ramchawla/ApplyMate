// Per-run chat: one streamed `claude -p` turn per message, validated proposals,
// and apply/undo that recompiles with the one-page fit rule. The run folder is
// the only state (chat.json, state.json), so a bridge restart loses nothing.
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ApplyResult, ChatEvent, ChatMessage, RunFile, RunState } from "../../../lib/shared/types";
import { compileLatexWithPages } from "../../../lib/local/compile-latex";
import { insertResumeVersion, listVersions, type Db } from "../../../lib/local/db";
import { readRun, scanRuns, writeChat, writeState } from "../../../lib/local/runs";
import { streamClaude, type StreamRunner } from "../../skill/src/tailor/claude-cli";
import { CHAT_SYSTEM, buildChatPrompt, splitReply } from "../../skill/src/tailor/chat";
import { validateProposals } from "../../skill/src/tailor/proposals";
import { parseResume, renderResume } from "../../skill/src/tailor/resume-doc";
import { coverLetterTex, profileName } from "../../skill/src/tailor/letter";
import { fitBudget, fits, HEIGHT_SLACK_PT, type Compiled } from "../../skill/src/tailor/fit";

export class BusyError extends Error {
  constructor() {
    super("busy");
    this.name = "BusyError";
  }
}

const MALFORMED_NOTE = "Couldn't read Claude's proposed changes — ask again";

export type Chat = ReturnType<typeof makeChat>;

export function makeChat(opts: {
  appsDir: string;
  dir: string; // ~/.applymate
  db?: Db;
  stream?: StreamRunner;
  compile?: (tex: string) => Promise<Compiled>;
}) {
  const stream = opts.stream ?? streamClaude;
  const compile = opts.compile ?? ((tex: string) => compileLatexWithPages(tex));
  let index = scanRuns(opts.appsDir);
  const busy = new Set<string>();
  const jobs = new Map<string, string>();
  // ponytail: per-run maps never shrink; one entry per run ever opened, fine for a local bridge.
  const applyQueue = new Map<string, Promise<unknown>>();
  const compiled = new Map<string, { tex: string; c: Compiled }>();

  const optional = (path: string) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return "";
    }
  };

  // Runs created after startup (or by another bridge) are found by one rescan.
  function dirOf(runId: string): string | undefined {
    if (!index.has(runId)) index = scanRuns(opts.appsDir);
    return index.get(runId);
  }

  function load(runId: string) {
    const dir = dirOf(runId);
    if (!dir) throw new Error(`unknown run ${runId}`);
    try {
      return { dir, ...readRun(dir) };
    } catch (err) {
      throw new Error(`run ${runId} unreadable: ${(err as Error).message}`);
    }
  }

  async function compileCached(key: string, tex: string): Promise<Compiled> {
    const hit = compiled.get(key);
    if (hit?.tex === tex) return hit.c;
    const c = await compile(tex);
    compiled.set(key, { tex, c });
    return c;
  }

  // One apply at a time per run, so a double-click sees the first apply's result.
  function serial<T>(runId: string, fn: () => Promise<T>): Promise<T> {
    const next = (applyQueue.get(runId) ?? Promise.resolve()).then(fn, fn);
    applyQueue.set(runId, next.catch(() => {}));
    return next;
  }

  async function applyNow(
    runId: string,
    ref: { messageIndex: number; proposalIndex: number; undo?: boolean },
  ): Promise<ApplyResult> {
    const run = load(runId);
    const msg = run.chat[ref.messageIndex];
    const p = msg?.proposals?.[ref.proposalIndex];
    if (!p) return { ok: false, reason: "unknown proposal" };
    const isApplied = (msg.applied ?? []).includes(ref.proposalIndex);
    if (!ref.undo && isApplied) return { ok: true, state: run.state, version: run.state.version };
    if (ref.undo && !isApplied) return { ok: false, reason: "not applied" };
    const value = ref.undo ? p.before : p.after;

    // Compute + write files first; state/chat are committed only once everything succeeded.
    let change: (s: RunState) => void;
    let resumeTex: string | undefined;
    if (p.target === "cover-letter") {
      if (run.report.wantCoverLetterPdf) {
        const { first, last } = profileName(optional(join(opts.dir, "profile.yaml")));
        const c = await compile(coverLetterTex(`${first} ${last}`.trim(), value));
        writeFileSync(join(run.dir, "cover-letter.pdf"), c.pdf);
      }
      writeFileSync(join(run.dir, "cover-letter.md"), value, "utf8");
      change = (s) => (s.coverLetter = value);
    } else if (p.target.startsWith("answer:")) {
      const fieldId = p.target.slice("answer:".length);
      change = (s) => (s.answers = { ...s.answers, [fieldId]: value });
    } else {
      const doc = parseResume(run.masterTex);
      if (!doc.parts.some((x) => x.id === p.target)) return { ok: false, reason: "unknown target" };
      const tex = renderResume(doc, { ...run.state.edits, [p.target]: value }, run.state.order);
      const c = await compile(tex);
      const budget = fitBudget(
        await compileCached(`${runId}:master`, run.masterTex),
        await compileCached(`${runId}:current`, renderResume(doc, run.state.edits, run.state.order)),
      );
      if (!fits(c, budget)) {
        if (c.pages > 1) return { ok: false, reason: "spills onto page 2" };
        const lines = Math.ceil(((c.height ?? 0) - budget - HEIGHT_SLACK_PT) / 12);
        return { ok: false, reason: `${lines} line${lines === 1 ? "" : "s"} too long` };
      }
      compiled.set(`${runId}:current`, { tex, c });
      writeFileSync(join(run.dir, "resume.tex"), tex, "utf8");
      writeFileSync(join(run.dir, "resume.pdf"), c.pdf);
      resumeTex = tex;
      change = (s) => (s.edits = { ...s.edits, [p.target]: value });
    }

    // Re-read so a chat turn that finished during the compile isn't overwritten.
    const fresh = load(runId);
    const state = fresh.state;
    change(state);
    state.version += 1;
    const m = fresh.chat[ref.messageIndex];
    const applied = m.applied ?? [];
    m.applied = ref.undo
      ? applied.filter((i) => i !== ref.proposalIndex)
      : [...applied, ref.proposalIndex];
    writeState(fresh.dir, state);
    writeChat(fresh.dir, fresh.chat);

    if (resumeTex !== undefined && opts.db) {
      const applicationId = fresh.report.applicationId;
      try {
        insertResumeVersion(opts.db, {
          id: randomUUID(),
          applicationId,
          versionNumber: listVersions(opts.db, applicationId).length + 1,
          latex: resumeTex,
          overallConfidence: 1,
          report: { runId, version: state.version },
        });
      } catch (err) {
        // Files are the source of truth; a missing dashboard row isn't worth failing the apply.
        console.error(`[ApplyMate] version row for ${runId} failed:`, err);
      }
    }
    return { ok: true, state, version: state.version };
  }

  return {
    has(runId: string): boolean {
      return !!dirOf(runId);
    },

    get(runId: string): { report: RunFile; state: RunState; chat: ChatMessage[] } | null {
      if (!dirOf(runId)) return null;
      try {
        const { report, state, chat } = load(runId);
        return { report, state, chat };
      } catch (err) {
        console.error(`[ApplyMate] ${(err as Error).message}`);
        return null;
      }
    },

    async send(runId: string, message: string, onEvent: (e: ChatEvent) => void): Promise<void> {
      if (busy.has(runId)) throw new BusyError();
      busy.add(runId);
      try {
        const run = load(runId);
        const userMsg: ChatMessage = { role: "user", text: message, at: Date.now() };
        let text: string;
        try {
          text = await stream({
            system: CHAT_SYSTEM,
            prompt: buildChatPrompt({
              jd: optional(join(run.dir, "jd.md")),
              doc: parseResume(run.masterTex),
              labels: run.report.labels,
              state: run.state,
              corpusYaml: optional(join(opts.dir, "experience.yaml")),
              profileYaml: optional(join(opts.dir, "profile.yaml")),
              history: run.chat,
              message,
            }),
            onDelta: (t) => onEvent({ t: "delta", text: t }),
            cwd: opts.dir,
          });
        } catch (err) {
          onEvent({ t: "error", message: (err as Error).message });
          return;
        }

        try {
          // Validate against the state as it is now (an apply may have landed mid-turn).
          const fresh = load(runId);
          const { reply, raw, parseError } = splitReply(text);
          const { proposals, dropped } = validateProposals(raw, {
            doc: parseResume(fresh.masterTex),
            labels: fresh.report.labels,
            state: fresh.state,
            corpusYaml: optional(join(opts.dir, "experience.yaml")),
          });
          const notes: string[] = [];
          if (dropped.length) {
            // Reasons only: dropped entries start with the raw target id, which the UI never shows.
            const reasons = [...new Set(dropped.map((d) => d.slice(d.indexOf(": ") + 2)))];
            notes.push(
              `(Dropped ${dropped.length} proposed change${dropped.length === 1 ? "" : "s"}: ${reasons.join("; ")}.)`,
            );
          }
          if (parseError) notes.push(MALFORMED_NOTE);
          const assistant: ChatMessage = {
            role: "assistant",
            text: [reply, ...notes].filter(Boolean).join("\n\n"),
            proposals: proposals.length ? proposals : undefined,
            at: Date.now(),
          };
          writeChat(fresh.dir, [...fresh.chat, userMsg, assistant]);
          onEvent({ t: "done", message: assistant });
        } catch (err) {
          onEvent({ t: "error", message: (err as Error).message });
        }
      } finally {
        busy.delete(runId);
      }
    },

    apply(
      runId: string,
      ref: { messageIndex: number; proposalIndex: number; undo?: boolean },
    ): Promise<ApplyResult> {
      return serial(runId, () => applyNow(runId, ref));
    },

    pdf(runId: string, kind: "resume" | "cover-letter"): Buffer | null {
      const dir = dirOf(runId);
      if (!dir) return null;
      try {
        return readFileSync(join(dir, `${kind}.pdf`));
      } catch {
        return null;
      }
    },

    runIdForJob(tailorJobId: string): string | undefined {
      return jobs.get(tailorJobId);
    },

    linkJob(tailorJobId: string, runId: string): void {
      jobs.set(tailorJobId, runId);
    },
  };
}
