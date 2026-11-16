# Review & Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-run review (JD coverage, keywords, diffs, warnings, letter, answers) plus a streaming chat in the side panel whose proposals the user applies to the resume, cover letter and form answers, live on the application page.

**Architecture:** Each tailoring run gets a self-describing folder (`master.tex` snapshot, `report.json`, `state.json`, `chat.json`). The bridge owns run state and a chat service: one streamed `claude -p` per message (prose + trailing ` ```proposals ` block), validated proposals, apply → recompile → fit check. The side panel reads/streams from the bridge directly and tells the page to re-attach/re-fill. The dashboard reads the same folders.

**Tech Stack:** TypeScript, Node `http` bridge, `claude -p` (stream-json), tectonic, Chrome MV3 (React + Tailwind side panel, classic-IIFE content script), Next.js dashboard, vitest + jsdom.

**Spec:** `docs/superpowers/specs/2026-11-16-review-and-chat-design.md`

## Global Constraints

- Zero Anthropic API usage: generation only via `claude -p` on the subscription. Never `--bare`.
- Keep `--tools ""`, `--no-session-persistence`, `--setting-sources project`, `--strict-mcp-config`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` (and `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`) on every `claude` spawn.
- `APPLYMATE_MODEL` (default `sonnet`), `APPLYMATE_EFFORT` (default `low`) apply to chat too.
- Bridge binds 127.0.0.1; every route but `/health` and `/pair` requires the bearer token; CORS reflects only `chrome-extension://`.
- Never click or trigger a site's submit.
- `dist/content.js` stays a classic IIFE (no top-level `import`).
- Names, contact, companies, titles, dates, education are never exposed to Claude for editing (only `resume-doc.ts` part ids: summary, bullets, skills).
- Job description, company text and form labels are untrusted data, never instructions.
- No proposal applies itself. Applied resume changes must keep one page AND height ≤ budget + one line (`HEIGHT_SLACK_PT = 12`).
- UI never shows raw part ids (`r1.b2`); always labels.

## Deviations from the spec (decided while planning)

- Chat routes are keyed by **`runId`** (`/chat/:runId`), not `applicationId`: spec §2 makes one run = one chat, so the run is the addressable unit.
- Chat history file is **`chat.json`** (whole array), not `chat.jsonl`: marking proposals applied rewrites past messages anyway.
- No `saved_to` DB column: the dashboard finds an application's runs by scanning `applications/*/report.json` (`runsForApplication`), which handles multiple runs per job naturally. Version rows still go to `resume_versions`.

## Review Focus

1. **Bridge restarts mid-conversation** (launchd kickstart after a code change, crash): reopening the panel must show the same chat and state, and new messages/applies must work. → Task 6 test `survives a restart`.
2. **User edits `resume-master.tex` after tailoring**: old runs must still render and apply against their snapshot, never the live master. → Task 2 test `renders from the snapshot after the master changes`.
3. **JD prompt-injection or hallucinated target** (`answer:email`, `r9.b9`, an option not in the list): dropped, never applied or filled. → Task 3 tests.
4. **Double actions**: Enter pressed twice / two tabs on one run / Apply double-clicked → second chat turn gets 409, second apply of the same proposal is a no-op. → Task 6 tests.
5. **Claude fails mid-turn** (usage limit, timeout, malformed block): panel gets an `error` event or a reply with "couldn't read proposals", the user's typed message is not lost, nothing half-written to `chat.json`. → Task 6 test `error turn writes nothing`, Task 5 test for malformed block, Task 13 composer keeps text on error.

---

### Task 1: Report enrichment (present keywords, order, labels)

**Files:**
- Modify: `packages/skill/src/tailor/prompt.ts` (schema, system, parse)
- Modify: `packages/skill/src/tailor/run.ts` (return `order`)
- Modify: `packages/skill/src/tailor/resume-doc.ts` (add `partLabels`)
- Modify: `lib/shared/types.ts` (`KeywordReport.present`)
- Test: `tests/skill/tailor-prompt.test.ts`, `tests/skill/tailor-run.test.ts`, `tests/skill/resume-doc.test.ts`

**Interfaces:**
- Produces: `KeywordReport = { present: {keyword: string; where: string}[]; injected: …; skipped: … }`; `TailorOutcome.order: Record<string, string[]>` (only valid permutations that were rendered); `partLabels(doc: ResumeDoc): Record<string, string>`.

- [ ] **Step 1: Failing tests**

```ts
// tailor-prompt.test.ts
expect((TAILOR_SCHEMA as any).properties.keywords.required).toEqual(["present", "injected", "skipped"]);
expect(TAILOR_SYSTEM).toMatch(/keywords\.present/);
expect(parseTailorOutput({}).keywords.present).toEqual([]);

// resume-doc.test.ts — "labels every part without ids"
const labels = partLabels(parseResume(FIXTURE));
expect(labels["summary"]).toBe("Summary");
expect(labels["r0.b0"]).toBe("Acme Corp · bullet 1");     // first " | " segment of the group heading
expect(labels["skills.languages"]).toBe("Skills · Languages");
expect(Object.values(labels).some((l) => /r\d+\.b\d+/.test(l))).toBe(false);

// tailor-run.test.ts — "returns the order it rendered"
// runner returns order [{role:"r0", ids:[reversed r0 ids]}] and a bogus [{role:"r0", ids:["x"]}] in a second test
expect(out.order).toEqual({ r0: reversedIds });   // non-permutation → {}
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm test:skill`
- [ ] **Step 3: Implement.** System prompt line: `keywords.present: important job keywords the resume already covered before your edits, and the id where each appears.` Label rule: group heading's first `" | "` segment (already includes "Company — sub" for nested roles) + ` · bullet ${i+1}`; skills: `Skills · ` + the `\textbf{…}` name as written. `run.ts` filters `order` with `isPermutation` before returning.
- [ ] **Step 4: Run, expect PASS** — `pnpm test:skill && pnpm type-check:skill`
- [ ] **Step 5: Commit** — `feat: report present keywords, applied order and part labels`

---

### Task 2: Run folders (snapshot, state, index)

**Files:**
- Create: `lib/local/runs.ts`
- Modify: `lib/shared/types.ts`
- Modify: `packages/bridge/src/tailor-job.ts`, `packages/bridge/src/persist.ts` (drop `saveApplicationFiles` in favour of `writeRun`)
- Test: `tests/bridge/runs.test.ts`, `tests/bridge/tailor-job.test.ts`

**Interfaces:**
- Consumes: Task 1 `partLabels`, `TailorOutcome.order`.
- Produces (types in `lib/shared/types.ts`):
  ```ts
  interface RunFile { applicationId: string; runId: string; createdAt: string;
    job: { title: string; company: string; url: string }; fileName: string; wantCoverLetterPdf: boolean;
    labels: Record<string, string>; questions: TailorQuestion[];
    keywords: KeywordReport; edits: EditRecord[]; warnings: string[]; pages: number }
  interface RunState { edits: Record<string, string>; order: Record<string, string[]>;
    coverLetter: string; answers: Record<string, string>; questions: TailorQuestion[]; version: number }
  interface Proposal { target: string; label: string; before: string; after: string; why: string; warnings: string[] }
  interface ChatMessage { role: "user" | "assistant"; text: string; proposals?: Proposal[]; applied?: number[]; at: number }
  // TailorResult gains: runId: string; labels: Record<string,string>; questions: TailorQuestion[]; version: number
  // KeywordReport (Task 1) unchanged here
  ```
  `lib/local/runs.ts`:
  `uniqueRunDir(appsDir: string, base: string): string` · `writeRun(dir, f: {report: RunFile; state: RunState; masterTex: string; resumeTex: string; resumePdf: Buffer; coverLetter: string; jd: string}): Promise<void>` · `readRun(dir): {report: RunFile; state: RunState; chat: ChatMessage[]; masterTex: string}` · `writeState(dir, state)` · `writeChat(dir, chat)` · `scanRuns(appsDir): Map<string /*runId*/, string /*dir*/>` · `runsForApplication(appsDir, applicationId): {dir: string; report: RunFile}[]` (newest `createdAt` first). Folders without `report.json.runId` (pre-existing runs) are skipped.

- [ ] **Step 1: Failing tests** (`runs.test.ts`, tmp dirs)

```ts
it("suffixes a same-day rerun instead of overwriting", () => {
  mkdirSync(join(apps, "2026-11-16-acme-sre"));
  expect(uniqueRunDir(apps, "2026-11-16-acme-sre")).toBe(join(apps, "2026-11-16-acme-sre-2"));
});
it("round-trips a run and indexes it by runId and applicationId", async () => { /* writeRun → readRun deepEquals; scanRuns.get(runId) === dir; runsForApplication order newest first */ });
it("skips legacy folders without a runId", () => { /* report.json {} → not in scanRuns */ });
```
`tailor-job.test.ts`: existing test now also asserts `existsSync(join(savedTo, "master.tex"))`, `readRun(savedTo).state.version === 0`, `out.result.runId` is a UUID, `out.result.labels["summary"] === "Summary"`; new test **"renders from the snapshot after the master changes"**: tailor, then overwrite `<dir>/resume-master.tex` with an extra bullet, then `renderResume(parseResume(readRun(savedTo).masterTex), state.edits, state.order)` equals the saved `resume.tex`.

- [ ] **Step 2: Run, expect FAIL** — `pnpm test:bridge`
- [ ] **Step 3: Implement.** `tailor-job.ts`: `runId = randomUUID()`; `dir = uniqueRunDir(appsDir, applicationDirName(...))`; initial state = `{ edits: active (non-reverted) edits, order: out.order, coverLetter, answers: Object.fromEntries(out.answers), questions: req.fields, version: 0 }`. Keep `persistOutput` (DB row) as is.
- [ ] **Step 4: PASS** — `pnpm test:bridge && pnpm type-check:bridge`
- [ ] **Step 5: Commit** — `feat: self-describing run folders with master snapshot and state`

---

### Task 3: Proposal validation and fit

**Files:**
- Create: `packages/skill/src/tailor/fit.ts`, `packages/skill/src/tailor/proposals.ts`
- Modify: `packages/skill/src/tailor/run.ts` (use `fit.ts`; `Compiled` and `HEIGHT_SLACK_PT` move to `fit.ts`, `run.ts` re-exports `Compiled`)
- Test: `tests/skill/proposals.test.ts`, `tests/skill/fit.test.ts`

**Interfaces:**
- Consumes: `checks.ts` (`latexProblem`, `editWarnings`, `droppedItems`, `keywordWarnings`), `extractMetrics`, Task 2 types.
- Produces:
  `fitBudget(master: Compiled, current?: Compiled): number` — `max(master.height, master.goal)`; if `current` is taller than that + slack, returns `current.height - HEIGHT_SLACK_PT` (spec §3.4 relaxation) · `fits(c: Compiled, budget: number): boolean` (moved from `run.ts`, same rule) · `validateProposals(raw: unknown, ctx: {doc: ResumeDoc; labels: Record<string,string>; state: RunState; corpusYaml: string}): {proposals: Proposal[]; dropped: string[]}`.

- [ ] **Step 1: Failing tests**

```ts
// fit.test.ts
expect(fits({ pages: 1, height: 700 }, 700)).toBe(true);
expect(fits({ pages: 1, height: 713 }, 700)).toBe(false);
expect(fits({ pages: 2, height: 600 }, 700)).toBe(false);
expect(fitBudget({ pages: 1, height: 700, goal: 690 } as any)).toBe(700);
expect(fitBudget({ pages: 1, height: 700 } as any, { pages: 1, height: 740 } as any)).toBe(728); // 740-12 → current itself fits

// proposals.test.ts
const r = validateProposals([
  { target: "summary", after: "New \\textbf{x}", why: "w" },
  { target: "r9.b9", after: "x", why: "w" },                 // unknown part
  { target: "answer:email", after: "a@b.c", why: "w" },      // not asked
  { target: "answer:q2", after: "7+", why: "w" },            // not an option
  { target: "answer:q2", after: "3-5", why: "w" },
  { target: "cover-letter", after: "Dear Hiring Team,…", why: "w" },
  { target: "r0.b0", after: "[r0.b0] Cut cost 99%", why: "w" }, // echoed label + invented metric
  { target: "skills.languages", after: "Go", why: "w" },      // drops items
], ctx);
expect(r.proposals.map((p) => p.target)).toEqual(["summary", "answer:q2", "cover-letter", "r0.b0", "skills.languages"]);
expect(r.dropped).toHaveLength(3);
expect(r.proposals[0]).toMatchObject({ label: "Summary", before: ctx.state.edits.summary ?? masterSummary });
expect(r.proposals[3].after.startsWith("[r0.b0]")).toBe(false);
expect(r.proposals[3].warnings.join(" ")).toMatch(/99%/);
expect(r.proposals[4].warnings.join(" ")).toMatch(/dropped/);
expect(validateProposals("nope", ctx)).toEqual({ proposals: [], dropped: [] });
expect(validateProposals([{ target: "summary", after: "\\textbf{x", why: "" }], ctx).dropped).toHaveLength(1); // latexProblem rejects
```
`before` = current state value (state edit → else master part text; `cover-letter` → `state.coverLetter`; `answer:<id>` → `state.answers[id] ?? ""`). Answer labels come from `state.questions`. Cover-letter label `"Cover letter"`.

- [ ] **Step 2: FAIL** — `pnpm test:skill`
- [ ] **Step 3: Implement**; `run.ts` imports `fits`/`fitBudget` with no behaviour change (existing `tailor-run` tests stay green).
- [ ] **Step 4: PASS** — `pnpm test:skill && pnpm type-check:skill`
- [ ] **Step 5: Commit** — `feat: validate chat proposals and share the fit rule`

---

### Task 4: Streaming `claude -p`

**Files:**
- Modify: `packages/skill/src/tailor/claude-cli.ts`
- Modify: `tests/skill/fixtures/fake-claude.mjs` (mode `stream`, `stream-error`)
- Test: `tests/skill/claude-cli.test.ts`

**Interfaces:**
- Produces: `type StreamRunner = (opts: StreamOptions) => Promise<string>`; `interface StreamOptions { system: string; prompt: string; onDelta: (text: string) => void; model?; effort?; cwd?; timeoutMs?; bin? }`; `streamClaude: StreamRunner` resolves the full concatenated text; rejects on `is_error` result line, non-zero exit with no text, or timeout (default 120 000 ms).

- [ ] **Step 1: Failing tests.** Fake `stream` mode prints NDJSON lines: two `{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"Hel"}}}` / `"lo"`, then `{"type":"result","is_error":false}`; it also echoes argv in a final text delta when `FAKE_CLAUDE_ECHO=1`.
```ts
const deltas: string[] = [];
expect(await streamClaude({ bin: FAKE, system: "S", prompt: "p", onDelta: (t) => deltas.push(t) })).toBe("Hello");
expect(deltas).toEqual(["Hel", "lo"]);
// args: --output-format stream-json, --verbose, --include-partial-messages, all isolation flags, no --json-schema, no --bare
// stream-error mode: {"type":"result","is_error":true,"result":"usage limit"} → rejects /usage limit/
```
- [ ] **Step 2: FAIL** — `pnpm test:skill`
- [ ] **Step 3: Implement** sharing the arg/env builder with `runClaude` (extract `baseArgs(opts)`), line-buffered stdout parsing as in the spike (`chat-spike.mjs`).
- [ ] **Step 4: PASS**
- [ ] **Step 5: Commit** — `feat: streamed claude -p runner`

---

### Task 5: Chat prompt and reply parsing

**Files:**
- Create: `packages/skill/src/tailor/chat.ts`
- Test: `tests/skill/chat.test.ts`

**Interfaces:**
- Consumes: `UNTRUSTED_LINE` from `prompt.ts`, Task 2 types.
- Produces: `CHAT_SYSTEM: string` · `buildChatPrompt(c: {jd: string; doc: ResumeDoc; labels: Record<string,string>; state: RunState; corpusYaml: string; profileYaml: string; history: ChatMessage[]; message: string}): string` · `splitReply(text: string): {reply: string; raw: unknown[] | null; parseError?: string}` · `CHAT_HISTORY_LIMIT = 20`.

- [ ] **Step 1: Failing tests**
```ts
expect(CHAT_SYSTEM).toMatch(/untrusted/i);
expect(CHAT_SYSTEM).toMatch(/Never invent metrics, employers, titles/);
expect(CHAT_SYSTEM).toContain("```proposals");
expect(CHAT_SYSTEM).toMatch(/answer:<fieldId>/);
const p = buildChatPrompt(ctx);
// order: JD, resume parts (label + "(max N chars)" N = master part length + current text), cover letter, questions+answers, corpus, profile, conversation; user message last
expect(p.indexOf("# Job description")).toBeLessThan(p.indexOf("# Conversation"));
expect(p).toContain("[r0.b0] Acme Corp · bullet 1 (max");
expect(p.trimEnd().endsWith(ctx.message)).toBe(true);
expect(buildChatPrompt({ ...ctx, history: Array(30).fill(msg) }).split("## User").length - 1).toBeLessThanOrEqual(21);

expect(splitReply("Hi.\n```proposals\n[{\"target\":\"summary\",\"after\":\"x\",\"why\":\"y\"}]\n```")).toEqual({ reply: "Hi.", raw: [{ target: "summary", after: "x", why: "y" }] });
expect(splitReply("Just talk.")).toEqual({ reply: "Just talk.", raw: null });
expect(splitReply("Hi.\n```proposals\n[{bad\n```").parseError).toBeTruthy();
```
System prompt text: start from the spike's `SYSTEM` (scratchpad `chat-spike.mjs`), add the LaTeX escaping rule from `TAILOR_SYSTEM` and "Answers for questions with options must be one option copied verbatim."
- [ ] **Step 2: FAIL** · **Step 3: Implement** · **Step 4: PASS** — `pnpm test:skill`
- [ ] **Step 5: Commit** — `feat: chat prompt and proposals block parsing`

---

### Task 6: Bridge chat service and routes

**Files:**
- Create: `packages/bridge/src/chat.ts`
- Modify: `packages/bridge/src/server.ts`, `packages/bridge/src/start.ts`
- Test: `tests/bridge/chat.test.ts`, `tests/bridge/chat-routes.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5; `compileLatexWithPages`, `coverLetterTex`, `insertResumeVersion`/`listVersions`.
- Produces:
  ```ts
  // in lib/shared/types.ts (the side panel consumes it in Task 13)
  type ChatEvent = { t: "delta"; text: string } | { t: "done"; message: ChatMessage } | { t: "error"; message: string };
  interface ApplyResult { ok: true; state: RunState; version: number } | { ok: false; reason: string }
  makeChat(opts: { appsDir: string; dir: string /*~/.applymate*/; db?: Db; stream?: StreamRunner; compile?: (tex: string) => Promise<Compiled> }): {
    get(runId): { report: RunFile; state: RunState; chat: ChatMessage[] } | null;
    send(runId, message: string, onEvent: (e: ChatEvent) => void): Promise<void>;   // throws BusyError when a turn is running for runId
    apply(runId, ref: { messageIndex: number; proposalIndex: number; undo?: boolean }): Promise<ApplyResult>;
    pdf(runId, kind: "resume" | "cover-letter"): Buffer | null;
    runIdForJob(tailorJobId): string | undefined; linkJob(tailorJobId, runId): void;  // used by Task 7
  }
  ```
  Routes (all token-protected): `GET /chat/:runId` → `get` JSON · `POST /chat/:runId {message}` → `200 application/x-ndjson`, one `ChatEvent` per line, `409 {error:"busy"}` while a turn runs, `404` unknown run · `POST /chat/:runId/apply {messageIndex, proposalIndex, undo?}` → `ApplyResult` (`409` when `ok:false`) · `GET /chat/:runId/resume.pdf` · `GET /chat/:runId/cover-letter.pdf`.

- [ ] **Step 1: Failing tests** (`chat.test.ts`, fake stream runner emitting the spike-style text, fake compile returning `{pages:1, height: tex.length % 1000}`-style controllable heights)
  - `streams deltas then a done message with validated proposals` — events `delta…, done`; `chat.json` gains user+assistant; done message `proposals[0].label === "Summary"`.
  - `talk-only reply has no proposals`.
  - `malformed block → reply ends with "Couldn't read Claude's proposed changes — ask again"` and `proposals` undefined.
  - `error turn writes nothing` — runner rejects → one `error` event; `chat.json` unchanged.
  - `second send while running → BusyError`.
  - `apply resume proposal: recompiles, saves state/tex/pdf, bumps version, adds resume_versions row, marks applied`.
  - `apply that doesn't fit → {ok:false, reason: /too long/}`, state unchanged.
  - `apply same proposal twice → second returns ok with unchanged version` (no-op).
  - `undo restores proposal.before and bumps version`.
  - `apply cover-letter recompiles the cover-letter PDF only when report.wantCoverLetterPdf`.
  - `apply answer updates state.answers`.
  - `survives a restart` — new `makeChat` over the same `appsDir` → `get(runId)` returns the chat; `send` works.
  `chat-routes.test.ts`: 401 without token; NDJSON body lines parse to events ending in `done`; concurrent POST → 409; apply 409 path; resume.pdf content-type `application/pdf`.
- [ ] **Step 2: FAIL** — `pnpm test:bridge`
- [ ] **Step 3: Implement.** Context per turn: `readRun(dir)` + `jd.md` + `experience.yaml` + `profile.yaml`. Apply resume: `renderResume(parseResume(masterTex), {...state.edits, [id]: after}, state.order)` → compile → `fits(c, fitBudget(compile(masterTex), compile(currentTex)))`; refusal reason `"${lines} lines too long"` with `lines = ceil((height - budget - slack)/12)`, or `"spills onto page 2"`. Cache the master/current compiles per run in memory. Version row: `insertResumeVersion` with `report: { runId, version }`. `start.ts` wires `makeChat({ appsDir: join(dir,"applications"), dir, db })`.
- [ ] **Step 4: PASS** — `pnpm test:bridge && pnpm type-check:bridge`
- [ ] **Step 5: Commit** — `feat: bridge chat service with streamed turns and apply`

---

### Task 7: State as source of truth + wizard answers (bridge side)

**Files:**
- Modify: `packages/bridge/src/server.ts`, `packages/bridge/src/tailor-job.ts`, `packages/bridge/src/chat.ts`
- Test: `tests/bridge/tailor-routes.test.ts`, `tests/bridge/answer-routes.test.ts`

**Interfaces:**
- Consumes: Task 6 `linkJob`/`runIdForJob`, Task 2 `readRun`/`writeState`.
- Produces: `GET /tailor/:id` `result` is overlaid with the run's current state (`coverLetter`, `answers` as `{fieldId,value}[]`, `questions`, `version`); `GET /tailor/:id/resume.pdf` and `cover-letter.pdf` serve the run folder's latest file once `version > 0`. `POST /answer` accepts optional `tailorJobId: string`; when its answers finish they merge into that run's `state.questions`/`state.answers` (replace by `fieldId`), or are held and merged when the tailoring job finishes.

- [ ] **Step 1: Failing tests**
  - `after a chat apply, /tailor/:id returns the new cover letter and version 1, and resume.pdf returns the new bytes`.
  - `/answer with tailorJobId merges answers into the run state` (tailoring already done).
  - `/answer finishing before tailoring is held and merged when tailoring finishes`.
  - `/answer without tailorJobId behaves exactly as today`.
- [ ] **Step 2: FAIL** · **Step 3: Implement** (tailor job result carries `runId`; server calls `chat.linkJob(jobId, runId)` when a tailor job completes) · **Step 4: PASS** — `pnpm test:bridge`
- [ ] **Step 5: Commit** — `feat: tailor routes serve current run state; wizard answers join the run`

---

### Task 8: Content script — page sync, versioned attach, state answers

**Files:**
- Create: `packages/extension/src/content/page-sync.ts`
- Modify: `packages/extension/src/content/content.ts`, `packages/extension/src/types.ts`, `packages/extension/src/background.ts` (new `FETCH_RUN_PDF { runId, kind }` → `GET /chat/:runId/<kind>.pdf`, same base64 shape as `FETCH_PDF`)
- Test: `tests/extension/page-sync.test.ts`, `tests/extension/wizard-run.test.ts`, `tests/extension/one-click.test.ts`

**Interfaces:**
- Consumes: `/tailor/:id` overlay (Task 7), `attachFile`, `applyFill`, `findField`, `extractLiveFields`.
- Produces: tab messages
  ```ts
  type PageSyncMsg =
    | { type: "REATTACH_RESUME"; runId: string; fileName: string; version: number }
    | { type: "REFILL_ANSWER"; label: string; value: string }
    | { type: "REFILL_COVER_LETTER"; runId: string; text: string; hasPdf: boolean; fileName: string };
  handlePageSync(doc: Document, msg: PageSyncMsg, deps: { send; touched: Set<string> }): Promise<"ok" | "not-found">
  ```
  Answers are matched by **normalized label** (lowercase, collapse whitespace, strip trailing `*`), because wizard field stamps change when a step re-renders. The listener in `content.ts` only calls `sendResponse` when the result is `"ok"` (frames without the field stay silent; no response = not-found).

- [ ] **Step 1: Failing tests** (jsdom fixtures like `one-click.test.ts`)
  - `REATTACH_RESUME attaches the fetched PDF to the resume input` → `ok`; `not-found` when no resume file input.
  - `REFILL_ANSWER fills by label and marks the field touched`; `not-found` when the label isn't on the page.
  - `REFILL_COVER_LETTER fills the textarea` / `attaches the cover-letter PDF when hasPdf`.
  - wizard-run: `a resume step re-attaches when result.version is newer than the attached one` (replaces the `shown.includes(fileName)` guard with a per-run `attachedVersion`; keep the text check only for version 0 to avoid re-attaching after a reload).
  - wizard-run: `step questions already answered in result.questions/answers (by label) are filled from state and not sent to /answer`; `ANSWER_START` request includes `tailorJobId`.
- [ ] **Step 2: FAIL** — `pnpm test` · **Step 3: Implement** (wizard re-polls `TAILOR_POLL` once per step after tailoring has finished, to see chat changes) · **Step 4: PASS** — `pnpm test && pnpm type-check && pnpm build:extension` then `head -c 200 packages/extension/dist/content.js` shows no top-level `import`.
- [ ] **Step 5: Commit** — `feat: page sync for chat changes; wizard reads current run state`

---

### Task 9: Slim widget

**Files:**
- Modify: `packages/extension/src/content/widget.ts`, `content.ts` (state fields)
- Test: `tests/extension/widget.test.ts`

**Interfaces:**
- Produces: `WidgetState` drops `injected`/`skipped`, gains `summary?: { covered: number; total: number; warnings: number }`; action `review` → existing `OPEN_SIDE_PANEL`.

- [ ] **Step 1: Failing tests** — after a run, card text contains `Tailored · coverage 14/19 · 2 warnings` and a `[data-action=review]` button labelled `Review & chat →`; no `.chip.ok`/`.chip.no` elements; all dynamic text still escaped (existing escape test stays).
- [ ] **Step 2: FAIL** · **Step 3: Implement** (coverage = (present + injected) / (present + injected + skipped)) · **Step 4: PASS** — `pnpm test`
- [ ] **Step 5: Commit** — `feat: slim widget with review & chat entry`

---

### Task 10: Mockup gate (HARD STOP)

**Files:**
- Create: `docs/superpowers/mockups/review-chat/panel.html`, `docs/superpowers/mockups/review-chat/dashboard.html`

- [ ] **Step 1:** Load `impeccable`, `frontend-design` and `ui-ux-pro-max` skills; design one token set (colors incl. diff add/del, status ok/warn/err, type scale, spacing, radius) for light + dark.
- [ ] **Step 2:** Static HTML, real data from a saved run (`~/.applymate/applications/2026-11-13-company-staff-ai-engineer-agentic-systems/`), panel at 380px wide with states: no run · report (Keywords / Changes / Letter / Answers / Warnings) · streaming reply · proposal card pending / applied (+Undo) / refused-too-long (+"Ask for shorter") / with warning / "earlier step" notice. Dashboard detail: header, coverage, runs list, report, versions, transcript.
- [ ] **Step 3:** Show both to the user (Artifact or browser). **Stop until they approve or adjust.**
- [ ] **Step 4:** Record the approved tokens and any layout changes in spec §5; commit mockups + spec — `docs: approved review & chat mockups`

---

### Task 11: Shared tokens and word diff

**Files:**
- Create: `lib/ui/tailwind-preset.cjs`, `lib/shared/word-diff.ts`
- Modify: extension and dashboard `tailwind.config.*` (`presets: [require("<rel>/lib/ui/tailwind-preset.cjs")]`)
- Test: `tests/extension/word-diff.test.ts`

**Interfaces:**
- Produces: `type DiffPart = { op: "same" | "add" | "del"; text: string }`; `wordDiff(before: string, after: string): DiffPart[]` (word-level LCS on whitespace-split tokens, whitespace kept with the preceding token; adjacent same-op parts merged). Tokens exactly as approved in Task 10.

- [ ] **Step 1: Failing tests**
```ts
expect(wordDiff("Led migration of 15 services", "Drove migration of 15 services")).toEqual([
  { op: "del", text: "Led " }, { op: "add", text: "Drove " }, { op: "same", text: "migration of 15 services" }]);
expect(wordDiff("a b", "a b")).toEqual([{ op: "same", text: "a b" }]);
expect(wordDiff("", "x")).toEqual([{ op: "add", text: "x" }]);
```
- [ ] **Step 2: FAIL** · **Step 3: Implement** · **Step 4: PASS** — `pnpm test`; both packages still build (`pnpm build:extension`, `pnpm build:dashboard`)
- [ ] **Step 5: Commit** — `feat: shared design tokens and word diff`

---

### Task 12: Side panel — report view

**Files:**
- Create: `lib/shared/run-view.ts` (shared with the dashboard in Task 14), `packages/extension/src/ui/components/ReportPanel.tsx`
- Modify: `packages/extension/src/ui/side-panel.tsx` (load `GET /chat/:runId` for the active tab's `lastRun.result.runId`; paste-JD + pairing move into a bottom "Settings" disclosure)
- Test: `tests/extension/run-view.test.ts`

**Interfaces:**
- Consumes: `RunFile`, `RunState` (Task 2), `wordDiff` (Task 11).
- Produces: `buildRunView(report: RunFile, state: RunState): RunView` where
  `RunView = { title: string; company: string; version: number; pages: number; coverage: { covered: number; total: number }; keywords: { keyword: string; status: "present" | "injected" | "skipped"; where?: string /*label*/; reason?: string }[]; changes: { id: string; label: string; before: string; after: string; reverted?: string }[]; warnings: string[]; letter: string; answers: { label: string; value: string }[] }`. `changes` reflect current state (tailoring edits overlaid with chat applies; reverted tailoring edits kept with reason). Unknown `where` ids fall back to `"Resume"`, never the raw id.

- [ ] **Step 1: Failing tests** — coverage counts; keyword `where` is a label; an id with no label → `"Resume"`; a chat-applied summary shows in `changes` with `before` = master text; answers use question labels.
- [ ] **Step 2: FAIL** · **Step 3: Implement** view model + `ReportPanel` per approved mockup ("Ask about this" on any keyword/change calls `onAsk(text)` with e.g. `Why did you skip rust?` / `About Acme Corp · bullet 2: `) · **Step 4: PASS** — `pnpm test && pnpm type-check`
- [ ] **Step 5: Commit** — `feat: side panel run report`

---

### Task 13: Side panel — chat

**Files:**
- Create: `packages/extension/src/ui/lib/ndjson.ts`, `packages/extension/src/ui/lib/page-sync.ts`, `packages/extension/src/ui/components/{ChatThread,ProposalCard,Composer}.tsx`
- Modify: `packages/extension/src/ui/side-panel.tsx`
- Test: `tests/extension/ndjson.test.ts`, `tests/extension/panel-sync.test.ts`

**Interfaces:**
- Consumes: Task 6 routes via `bridgeFetch`, Task 8 `PageSyncMsg`, Task 12 `buildRunView`.
- Produces: `readNdjson(body: ReadableStream<Uint8Array>, onEvent: (e: ChatEvent) => void): Promise<void>` (handles lines split across chunks; ignores blank/garbage lines) · `syncToPage(tabId: number, p: Proposal, run: { runId: string; fileName: string; version: number; hasCoverLetterPdf: boolean }): Promise<"ok" | "not-found">` (resume target → `REATTACH_RESUME`, `cover-letter` → `REFILL_COVER_LETTER`, `answer:<id>` → `REFILL_ANSWER` with the question label).

- [ ] **Step 1: Failing tests** — ndjson: a line split over two chunks yields one event; three events in one chunk yield three. panel-sync: maps each target kind to the right message (mock `chrome.tabs.sendMessage`), undefined response → `"not-found"`.
- [ ] **Step 2: FAIL** · **Step 3: Implement**:
  - Composer: Enter sends, Shift+Enter newline; disabled while a turn streams; on `error` event or fetch failure the typed text is restored and the error shown inline; 409 → "Still answering the last message".
  - Streaming reply renders deltas, hides a partial ` ```proposals ` block while streaming (show "Preparing changes…"), then cards from `done`.
  - ProposalCard: label, `wordDiff(before, after)`, why, warnings, [Apply] [Dismiss]; applied → [Undo]; apply `ok:false` → reason + "Ask for shorter" (sends `Make the <label> change shorter so it fits on one page.`); after apply → `syncToPage`; `not-found` → resume: "Resume step isn't on screen. Go back to it and press ↻ Re-attach, or Download PDF" (`/chat/:runId/resume.pdf`); answer: "That question is on an earlier step. Go back to it and the new answer fills in".
  - Report refreshes from `GET /chat/:runId` after each apply.
- [ ] **Step 4: PASS** — `pnpm test && pnpm type-check && pnpm build:extension`
- [ ] **Step 5: Commit** — `feat: side panel chat with proposals and page sync`

---

### Task 14: Dashboard — application detail

**Files:**
- Modify: `packages/dashboard/lib/data.ts`, `packages/dashboard/app/applications/[id]/page.tsx`, `packages/dashboard/components/BulletDiff.tsx` (use `wordDiff`)
- Create: `packages/dashboard/components/{RunReport,ChatTranscript}.tsx`
- Test: `packages/dashboard/test/runs-data.test.ts`

**Interfaces:**
- Consumes: `runsForApplication`, `readRun` (Task 2), `buildRunView` from `lib/shared/run-view.ts` (Task 12).
- Produces: `getRuns(applicationId: string): { runId: string; createdAt: string; view: RunView; chat: ChatMessage[] }[]`.

- [ ] **Step 1: Failing test** — tmp `APPLYMATE_DIR` with two runs for one application → newest first, views built, legacy folder ignored.
- [ ] **Step 2: FAIL** · **Step 3: Implement** page per approved mockup: header + status + coverage, runs list (selected run via `?run=`), read-only report, versions with PDF links, transcript (proposals marked applied/dismissed) · **Step 4: PASS** — `(cd packages/dashboard && npx vitest run)`, `pnpm build:dashboard`
- [ ] **Step 5: Commit** — `feat: dashboard run report and chat transcript`

---

### Task 15: Docs and end-to-end check

**Files:**
- Modify: `CLAUDE.md` (How it works: run folders, chat; Key files; Local files table: `master.tex`, `state.json`, `chat.json`; routes list)

- [ ] **Step 1:** Full suite: `pnpm test && pnpm test:skill && pnpm test:bridge && (cd packages/dashboard && npx vitest run) && pnpm type-check && pnpm type-check:skill && pnpm type-check:bridge` — all pass.
- [ ] **Step 2:** `launchctl kickstart -k gui/$(id -u)/com.applymate.bridge`; `pnpm build:extension`, reload at `chrome://extensions`.
- [ ] **Step 3:** Manual run on a real Greenhouse/Lever/Ashby posting: ⚡ → widget shows coverage + Review & chat → panel report has labels (no `r1.b2`) → ask "make the summary punchier" → reply streams in < ~6s → Apply → PDF re-attached on the page, version v1 → Undo → v2 → ask "add that I led 12 engineers" → pushback, no applicable invented claim → restart bridge → panel still shows the chat → dashboard detail shows run + transcript. Then one Workday run: chat-applied answer on an earlier step shows the "earlier step" notice and fills when going back.
- [ ] **Step 4:** Commit — `docs: review & chat in CLAUDE.md`
