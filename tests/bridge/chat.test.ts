import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeChat, BusyError } from "../../packages/bridge/src/chat";
import { readRun, writeRun } from "../../lib/local/runs";
import { openDb, migrate, insertApplication, listVersions } from "../../lib/local/db";
import { parseResume, partLabels } from "../../packages/skill/src/tailor/resume-doc";
import type { StreamRunner } from "../../packages/skill/src/tailor/claude-cli";
import type { ChatEvent, RunState } from "../../lib/shared/types";

const masterTex = readFileSync(
  fileURLToPath(new URL("../skill/fixtures/resume-master.tex", import.meta.url)),
  "utf8",
);
const doc = parseResume(masterTex);
const masterSummary = doc.parts.find((p) => p.id === "summary")!.text;

const RUN_ID = "run-1";

async function setup(opts: { wantCoverLetterPdf?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "am-chat-"));
  writeFileSync(join(dir, "experience.yaml"), "experiences: []\n");
  writeFileSync(join(dir, "profile.yaml"), "name: {first: Jane, last: Dev}\n");
  const appsDir = join(dir, "applications");
  const runDir = join(appsDir, "2026-11-16-acme-sre");
  const state: RunState = {
    edits: {},
    order: {},
    coverLetter: "Dear Hiring Team, old.",
    answers: { q2: "1-2" },
    questions: [
      { fieldId: "q2", label: "Years of Python", type: "select", options: ["1-2", "3-5"], required: true },
    ],
    version: 0,
  };
  await writeRun(runDir, {
    report: {
      applicationId: "app_1",
      runId: RUN_ID,
      createdAt: "2026-11-16T10:00:00.000Z",
      job: { title: "SRE", company: "Acme", url: "https://x/1" },
      fileName: "Jane_Dev_Acme_SRE.pdf",
      wantCoverLetterPdf: opts.wantCoverLetterPdf ?? false,
      labels: partLabels(doc),
      questions: state.questions,
      keywords: { present: [], injected: [], skipped: [] },
      edits: [],
      warnings: [],
      pages: 1,
    },
    state,
    masterTex,
    resumeTex: masterTex,
    resumePdf: Buffer.from("%PDF-orig"),
    coverLetter: state.coverLetter,
    jd: "Build reliable systems.",
  });
  return { dir, appsDir, runDir };
}

// Prose then a trailing proposals block, as `claude -p` streams it.
const reply = (prose: string, proposals?: unknown[] | string) =>
  proposals === undefined
    ? prose
    : `${prose}\n\n\`\`\`proposals\n${typeof proposals === "string" ? proposals : JSON.stringify(proposals)}\n\`\`\``;

function fakeStream(text: string, seen: { prompt?: string } = {}): StreamRunner {
  return async (opts) => {
    seen.prompt = opts.prompt;
    for (let i = 0; i < text.length; i += 20) opts.onDelta(text.slice(i, i + 20));
    return text;
  };
}

// Heights are controlled by markers in the tex: LONGLONG = 8 lines over, SPILL = page 2.
const fakeCompile = async (tex: string) => ({
  pdf: Buffer.from(`%PDF-${tex.length}`),
  pages: tex.includes("SPILL") ? 2 : 1,
  height: tex.includes("LONGLONG") ? 800 : 700,
  goal: 0,
});

async function collect(chat: ReturnType<typeof makeChat>, message: string) {
  const events: ChatEvent[] = [];
  await chat.send(RUN_ID, message, (e) => events.push(e));
  return events;
}

const SUMMARY_PROPOSAL = { target: "summary", after: "Reliability engineer who ships.", why: "tighter" };

async function chatWith(proposals: unknown[], extra: Partial<Parameters<typeof makeChat>[0]> = {}) {
  const s = await setup();
  const chat = makeChat({
    appsDir: s.appsDir,
    dir: s.dir,
    stream: fakeStream(reply("Here you go.", proposals)),
    compile: fakeCompile,
    ...extra,
  });
  await collect(chat, "fix it");
  return { ...s, chat };
}

describe("makeChat.send", () => {
  it("streams deltas then a done message with validated proposals", async () => {
    const s = await setup();
    const seen: { prompt?: string } = {};
    const chat = makeChat({
      appsDir: s.appsDir,
      dir: s.dir,
      stream: fakeStream(reply("The summary is vague.", [SUMMARY_PROPOSAL]), seen),
      compile: fakeCompile,
    });
    const events = await collect(chat, "Make the summary sharper");
    expect(events.slice(0, -1).every((e) => e.t === "delta")).toBe(true);
    expect(events.length).toBeGreaterThan(2);
    const done = events.at(-1)!;
    expect(done.t).toBe("done");
    if (done.t !== "done") return;
    expect(done.message.role).toBe("assistant");
    expect(done.message.text).toBe("The summary is vague.");
    expect(done.message.proposals![0].label).toBe("Summary");
    expect(done.message.proposals![0].before).toBe(masterSummary);
    // The new message appears exactly once in the prompt, with the JD and corpus.
    expect(seen.prompt!.split("Make the summary sharper").length).toBe(2);
    expect(seen.prompt).toContain("Build reliable systems.");
    expect(seen.prompt).toContain("experiences: []");
    const { chat: saved } = readRun(s.runDir);
    expect(saved.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(saved[0].text).toBe("Make the summary sharper");
    expect(saved[1].proposals).toHaveLength(1);
  });

  it("raw part and question ids in Claude's prose become labels before saving", async () => {
    const s = await setup();
    const chat = makeChat({
      appsDir: s.appsDir,
      dir: s.dir,
      stream: fakeStream("Your summary is fine; [summary] could lose a word, and answer:q2 should be 3-5."),
      compile: fakeCompile,
    });
    const done = (await collect(chat, "thoughts?")).at(-1)!;
    const want = "Your summary is fine; Summary could lose a word, and Years of Python should be 3-5.";
    expect(done.t === "done" && done.message.text).toBe(want);
    expect(readRun(s.runDir).chat[1].text).toBe(want);
  });

  it("passes earlier history to the prompt", async () => {
    const s = await setup();
    const seen: { prompt?: string } = {};
    const chat = makeChat({ appsDir: s.appsDir, dir: s.dir, stream: fakeStream("ok", seen), compile: fakeCompile });
    await collect(chat, "first question");
    await collect(chat, "second question");
    expect(seen.prompt).toContain("first question");
    expect(seen.prompt!.split("second question").length).toBe(2);
    expect(readRun(s.runDir).chat).toHaveLength(4);
  });

  it("talk-only reply has no proposals", async () => {
    const s = await setup();
    const chat = makeChat({ appsDir: s.appsDir, dir: s.dir, stream: fakeStream("Looks good."), compile: fakeCompile });
    const done = (await collect(chat, "thoughts?")).at(-1)!;
    expect(done.t === "done" && done.message.proposals).toBeUndefined();
    expect(done.t === "done" && done.message.text).toBe("Looks good.");
  });

  it("malformed block → reply ends with the couldn't-read note and no proposals", async () => {
    const s = await setup();
    const chat = makeChat({
      appsDir: s.appsDir,
      dir: s.dir,
      stream: fakeStream(reply("Try this.", "[{oops")),
      compile: fakeCompile,
    });
    const done = (await collect(chat, "fix")).at(-1)!;
    if (done.t !== "done") throw new Error("expected done");
    expect(done.message.text.endsWith("Couldn't read Claude's proposed changes — ask again")).toBe(true);
    expect(done.message.proposals).toBeUndefined();
  });

  it("dropped proposals are noted in the reply without raw ids", async () => {
    const s = await setup();
    const chat = makeChat({
      appsDir: s.appsDir,
      dir: s.dir,
      stream: fakeStream(reply("Here.", [SUMMARY_PROPOSAL, { target: "r9.b9", after: "x", why: "" }])),
      compile: fakeCompile,
    });
    const done = (await collect(chat, "fix")).at(-1)!;
    if (done.t !== "done") throw new Error("expected done");
    expect(done.message.proposals).toHaveLength(1);
    expect(done.message.text).toMatch(/1 proposed change/);
    expect(done.message.text).not.toContain("r9.b9");
  });

  it("error turn writes nothing", async () => {
    const s = await setup();
    const chat = makeChat({
      appsDir: s.appsDir,
      dir: s.dir,
      stream: async (o) => {
        o.onDelta("partial ");
        throw new Error("usage limit reached");
      },
      compile: fakeCompile,
    });
    const events = await collect(chat, "hi");
    expect(events.at(-1)).toEqual({ t: "error", message: "usage limit reached" });
    expect(events.filter((e) => e.t === "error")).toHaveLength(1);
    expect(existsSync(join(s.runDir, "chat.json"))).toBe(false);
  });

  it("second send while running → BusyError", async () => {
    const s = await setup();
    let release!: () => void;
    let calls = 0;
    const chat = makeChat({
      appsDir: s.appsDir,
      dir: s.dir,
      stream: () =>
        calls++ === 0 ? new Promise((r) => (release = () => r("done"))) : Promise.resolve("ok"),
      compile: fakeCompile,
    });
    const first = chat.send(RUN_ID, "one", () => {});
    await expect(chat.send(RUN_ID, "two", () => {})).rejects.toBeInstanceOf(BusyError);
    release();
    await first;
    await expect(collect(chat, "three")).resolves.toBeDefined();
  });

  it("unknown run is null; a run created after startup is found by rescanning", async () => {
    const s = await setup();
    const chat = makeChat({ appsDir: join(s.dir, "elsewhere"), dir: s.dir, stream: fakeStream("x"), compile: fakeCompile });
    expect(chat.get("nope")).toBeNull();
    expect(chat.has("nope")).toBe(false);
    const late = makeChat({ appsDir: s.appsDir, dir: s.dir, stream: fakeStream("x"), compile: fakeCompile });
    await writeRun(join(s.appsDir, "later"), {
      ...readRun(s.runDir),
      report: { ...readRun(s.runDir).report, runId: "run-2" },
      resumeTex: masterTex,
      resumePdf: Buffer.from("%PDF"),
      coverLetter: "",
      jd: "",
    });
    expect(late.get("run-2")?.report.runId).toBe("run-2");
  });

  it("corrupt run files → get returns null, send rejects, bridge keeps going", async () => {
    const s = await setup();
    writeFileSync(join(s.runDir, "state.json"), "{not json");
    const chat = makeChat({ appsDir: s.appsDir, dir: s.dir, stream: fakeStream("x"), compile: fakeCompile });
    expect(chat.has(RUN_ID)).toBe(true);
    expect(chat.get(RUN_ID)).toBeNull();
    await expect(chat.send(RUN_ID, "hi", () => {})).rejects.toThrow(/unreadable/);
    await expect(chat.apply(RUN_ID, { messageIndex: 0, proposalIndex: 0 })).rejects.toThrow(/unreadable/);
  });

  it("survives a restart", async () => {
    const { appsDir, dir, runDir } = await chatWith([SUMMARY_PROPOSAL]);
    const again = makeChat({ appsDir, dir, stream: fakeStream("Still here."), compile: fakeCompile });
    expect(again.get(RUN_ID)!.chat).toHaveLength(2);
    const r = await again.apply(RUN_ID, { messageIndex: 1, proposalIndex: 0 });
    expect(r.ok).toBe(true);
    const done = (await collect(again, "and now?")).at(-1)!;
    expect(done.t).toBe("done");
    expect(readRun(runDir).chat).toHaveLength(4);
    expect(readRun(runDir).chat[1].applied).toEqual([0]);
  });
});

describe("makeChat.apply", () => {
  it("apply resume proposal: recompiles, saves state/tex/pdf, bumps version, adds a version row, marks applied", async () => {
    const db = openDb(":memory:");
    migrate(db);
    insertApplication(db, { id: "app_1", company: "Acme", jobTitle: "SRE", jobUrl: "https://x/1", status: "drafted" });
    const { chat, runDir } = await chatWith([SUMMARY_PROPOSAL], { db });
    const r = await chat.apply(RUN_ID, { messageIndex: 1, proposalIndex: 0 });
    expect(r).toMatchObject({ ok: true, version: 1 });
    const run = readRun(runDir);
    expect(run.state.version).toBe(1);
    expect(run.state.edits.summary).toBe(SUMMARY_PROPOSAL.after);
    expect(run.chat[1].applied).toEqual([0]);
    const tex = readFileSync(join(runDir, "resume.tex"), "utf8");
    expect(tex).toContain(SUMMARY_PROPOSAL.after);
    expect(readFileSync(join(runDir, "resume.pdf"), "utf8")).toBe(`%PDF-${tex.length}`);
    expect(chat.pdf(RUN_ID, "resume")!.toString()).toBe(`%PDF-${tex.length}`);
    const versions = listVersions(db, "app_1");
    expect(versions).toHaveLength(1);
    expect(versions[0].report).toEqual({ runId: RUN_ID, version: 1, label: "Summary" });
    expect(versions[0].latex).toBe(tex);
  });

  it("apply that doesn't fit → too long, state unchanged", async () => {
    const { chat, runDir } = await chatWith([
      { target: "summary", after: "LONGLONG summary", why: "" },
      { target: "r0.b0", after: "SPILL bullet", why: "" },
    ]);
    const before = readRun(runDir);
    expect(await chat.apply(RUN_ID, { messageIndex: 1, proposalIndex: 0 })).toEqual({
      ok: false,
      reason: "8 lines too long",
    });
    expect(await chat.apply(RUN_ID, { messageIndex: 1, proposalIndex: 1 })).toEqual({
      ok: false,
      reason: "spills onto page 2",
    });
    const after = readRun(runDir);
    expect(after.state).toEqual(before.state);
    expect(after.chat[1].applied).toBeUndefined();
    expect(readFileSync(join(runDir, "resume.pdf"), "utf8")).toBe("%PDF-orig");
  });

  it("compiles the master once per run (cached)", async () => {
    let calls = 0;
    const counting = async (tex: string) => (calls++, fakeCompile(tex));
    const { chat } = await chatWith(
      [SUMMARY_PROPOSAL, { target: "r0.b0", after: "Shipped \\textbf{things}.", why: "" }],
      { compile: counting },
    );
    await chat.apply(RUN_ID, { messageIndex: 1, proposalIndex: 0 });
    const first = calls;
    await chat.apply(RUN_ID, { messageIndex: 1, proposalIndex: 1 });
    expect(calls - first).toBe(1);
  });

  it("apply same proposal twice → second is a no-op with the same version", async () => {
    const { chat, runDir } = await chatWith([SUMMARY_PROPOSAL]);
    const [a, b] = await Promise.all([
      chat.apply(RUN_ID, { messageIndex: 1, proposalIndex: 0 }),
      chat.apply(RUN_ID, { messageIndex: 1, proposalIndex: 0 }),
    ]);
    expect(a).toMatchObject({ ok: true, version: 1 });
    expect(b).toMatchObject({ ok: true, version: 1 });
    expect(readRun(runDir).chat[1].applied).toEqual([0]);
  });

  it("undo restores proposal.before and bumps version", async () => {
    const { chat, runDir } = await chatWith([SUMMARY_PROPOSAL]);
    expect(await chat.apply(RUN_ID, { messageIndex: 1, proposalIndex: 0, undo: true })).toEqual({
      ok: false,
      reason: "not applied",
    });
    await chat.apply(RUN_ID, { messageIndex: 1, proposalIndex: 0 });
    const r = await chat.apply(RUN_ID, { messageIndex: 1, proposalIndex: 0, undo: true });
    expect(r).toMatchObject({ ok: true, version: 2 });
    const run = readRun(runDir);
    expect(run.state.edits.summary).toBe(masterSummary);
    expect(run.chat[1].applied).toEqual([]);
    expect(readFileSync(join(runDir, "resume.tex"), "utf8")).toContain(masterSummary);
  });

  it("two proposals on the summary: only the one in effect stays marked; undo can't wipe a newer edit", async () => {
    const s = await setup();
    const X = { target: "summary", after: "Summary X.", why: "" };
    const Y = { target: "summary", after: "Summary Y.", why: "" };
    const replies = [reply("A.", [X]), reply("B.", [Y])];
    const chat = makeChat({
      appsDir: s.appsDir,
      dir: s.dir,
      stream: async () => replies.shift()!,
      compile: fakeCompile,
    });
    await collect(chat, "a");
    expect(await chat.apply(RUN_ID, { messageIndex: 1, proposalIndex: 0 })).toMatchObject({ ok: true, version: 1 });
    await collect(chat, "b");
    expect(readRun(s.runDir).chat[3].proposals![0].before).toBe("Summary X.");
    expect(await chat.apply(RUN_ID, { messageIndex: 3, proposalIndex: 0 })).toMatchObject({ ok: true, version: 2 });
    let run = readRun(s.runDir);
    expect(run.chat[1].applied).toEqual([]);
    expect(run.chat[3].applied).toEqual([0]);

    // A is no longer in effect: undo refuses, re-apply really applies.
    expect(await chat.apply(RUN_ID, { messageIndex: 1, proposalIndex: 0, undo: true })).toEqual({
      ok: false,
      reason: "not applied",
    });
    expect(await chat.apply(RUN_ID, { messageIndex: 1, proposalIndex: 0 })).toMatchObject({ ok: true, version: 3 });
    run = readRun(s.runDir);
    expect(run.state.edits.summary).toBe("Summary X.");
    expect(run.chat[1].applied).toEqual([0]);
    expect(run.chat[3].applied).toEqual([]);

    // Something else changed the summary since A was applied: undo refuses.
    writeFileSync(
      join(s.runDir, "state.json"),
      JSON.stringify({ ...run.state, edits: { summary: "Changed elsewhere." } }),
    );
    expect(await chat.apply(RUN_ID, { messageIndex: 1, proposalIndex: 0, undo: true })).toEqual({
      ok: false,
      reason: "changed since — undo the newer change",
    });
    expect(readRun(s.runDir).state.edits.summary).toBe("Changed elsewhere.");
  });

  it("unknown proposal → not ok", async () => {
    const { chat } = await chatWith([SUMMARY_PROPOSAL]);
    expect(await chat.apply(RUN_ID, { messageIndex: 0, proposalIndex: 0 })).toEqual({
      ok: false,
      reason: "unknown proposal",
    });
  });

  it("apply cover-letter recompiles the cover-letter PDF only when report.wantCoverLetterPdf", async () => {
    const letter = { target: "cover-letter", after: "Dear Acme, new letter.", why: "" };
    for (const want of [false, true]) {
      const s = await setup({ wantCoverLetterPdf: want });
      const chat = makeChat({ appsDir: s.appsDir, dir: s.dir, stream: fakeStream(reply("Here.", [letter])), compile: fakeCompile });
      await collect(chat, "letter");
      const r = await chat.apply(RUN_ID, { messageIndex: 1, proposalIndex: 0 });
      expect(r).toMatchObject({ ok: true, version: 1 });
      expect(readRun(s.runDir).state.coverLetter).toBe(letter.after);
      expect(readFileSync(join(s.runDir, "cover-letter.md"), "utf8")).toBe(letter.after);
      expect(existsSync(join(s.runDir, "cover-letter.pdf"))).toBe(want);
      expect(chat.pdf(RUN_ID, "cover-letter") !== null).toBe(want);
      expect(readFileSync(join(s.runDir, "resume.pdf"), "utf8")).toBe("%PDF-orig");
    }
  });

  it("apply answer updates state.answers", async () => {
    const { chat, runDir } = await chatWith([{ target: "answer:q2", after: "3-5", why: "" }]);
    const r = await chat.apply(RUN_ID, { messageIndex: 1, proposalIndex: 0 });
    expect(r).toMatchObject({ ok: true, version: 1 });
    if (r.ok) expect(r.state.answers.q2).toBe("3-5");
    expect(readRun(runDir).state.answers.q2).toBe("3-5");
  });

  it("links tailor jobs to runs", async () => {
    const s = await setup();
    const chat = makeChat({ appsDir: s.appsDir, dir: s.dir, stream: fakeStream("x"), compile: fakeCompile });
    expect(chat.runIdForJob("job-1")).toBeUndefined();
    chat.linkJob("job-1", RUN_ID);
    expect(chat.runIdForJob("job-1")).toBe(RUN_ID);
  });
});
