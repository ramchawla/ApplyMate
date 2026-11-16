# ApplyMate: Review & Chat — Design

**Date**: 2026-11-16
**Status**: Approved in chat (2026-11-16)
**Builds on**: `2026-09-28-one-click-core-design.md`, `2026-09-28-multistep-ats-design.md`

## Why

Tailoring is a black box. After ⚡ the user gets a PDF, a few ✓/✗ chips and
a raw dump in the side panel (`r1.b0`, unlabeled before/after). They can't
tell what the JD asked for, what went in, what didn't and why, or fix any of
it before pressing Submit. Goal: **maximize interview rate** by letting the
user check and correct every tailored artifact while still on the
application page, through a conversation with Claude.

## Goals

1. **Check**: one clear view per application of JD keyword coverage,
   injected/skipped keywords (with human locations, not ids), per-bullet
   diffs, reverted edits and why, warnings, cover letter, drafted answers.
2. **Fix by conversation**: a chat per application. The user types
   ("this bullet sounds inflated", "push Kubernetes", "why skip Rust?");
   Claude replies and may attach **proposals** for resume parts, the cover
   letter, or drafted form answers. Nothing changes until the user clicks
   Apply on a proposal.
3. **Live on the page**: an applied resume change rebuilds the PDF and
   re-attaches it to the form; an applied answer re-fills its field; an
   applied cover letter re-fills the cover-letter textarea and/or
   re-attaches the cover-letter PDF.
4. **History**: the dashboard shows each application's report, versions and
   chat transcript (read-only).
5. **Feels fast**: reply text streams (first words ~1–6s, done ~5–9s,
   measured in the spike below).

## Non-goals

- Variant resumes / archetype picker, discovery feed, auto-submit (separate
  roadmap items).
- Chat-driven changes to the **master** resume, corpus or profile. Chat only
  edits this application's tailored copy.
- Editing names, contact, companies, titles, dates, education (still never
  exposed to Claude; `resume-doc.ts` ids only).
- A persistent `claude` process per chat (approach C below). Possible later
  optimization.

## Anti-goals (failure even if it "works")

- Chat that invents claims. Every proposal goes through the same checks as
  tailoring and shows its warnings on the card; the "never invent metrics/
  employers/titles/dates" rule is in the chat system prompt.
- Silent changes. No proposal applies itself.
- A proposal targeting something it shouldn't (JD prompt-injection writing
  to the email field): targets are allow-listed (§3.3).
- Breaking one-page fit. An applied resume change that doesn't fit is
  refused with a reason ("2 lines too long — ask for a shorter version"),
  not silently reverted elsewhere.
- Leaking the user's global Claude setup (caveman style, hooks) into
  outputs: same isolation flags as tailoring.

## Constraints (unchanged from CLAUDE.md)

Zero API usage (`claude -p` on the subscription, never `--bare`); keep
`--tools ""`, `--no-session-persistence`, `--setting-sources project`,
`--strict-mcp-config`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`. Bridge binds
127.0.0.1 and requires the token. Never click Submit. `content.js` stays a
classic IIFE.

## Approaches considered (chat engine)

| | Approach | Trade-off |
|---|---|---|
| A | One `claude -p` per message with `--json-schema` (as tailoring does) | Simplest. Measured **~19s** per proposal turn, nothing on screen until done (structured output adds a tool turn + reasoning). |
| **B** ✅ | One `claude -p` per message, `--output-format stream-json --include-partial-messages`, no schema; prose reply then one fenced ` ```proposals ` JSON block | Reply streams; proposals parsed when the turn ends. Full context resent each turn (cheap: 16k tokens ≈ 1s). Isolation flags unchanged. |
| C | Long-lived `claude` process per chat (`--input-format stream-json`) | Saves ~1s startup + cache hits on follow-ups, but process lifecycle (idle kill, crash, bridge restart loses the chat). Layer on B later if needed. |

**User picked B.** Spike (`chat-spike.mjs`, throwaway, real files):

| Turn | First word | Total | Outcome |
|---|---|---|---|
| Talk only | 3.9s | 6.4s | no block (correct) |
| Resume edit | 5.8s | 8.4s | 1 summary proposal, corpus-grounded |
| Cover letter | 5.5s | 9.0s | full letter, new opener |
| Form answer | 5.0s | 8.6s | proposal + asked user for company detail the JD lacked |
| "Add I led 12 engineers" | 1.1s | 4.6s | refused (corpus lists it as not done), offered a backed alternative |
| Follow-up "shorter, keep MCP bold" | 3.5s | 5.6s | used history correctly |

6/6 blocks parsed. Format and guardrails hold without schema enforcement.

## 1. Data the report needs

Already produced per run (`TailorResult`): `keywords.injected {keyword,
where}`, `keywords.skipped {keyword, reason}`, `edits {id, before, after,
reverted?}`, `warnings`, `coverLetter`, `answers`, `pages`, `fileName`,
`savedTo`.

Added:

- **`keywords.present {keyword, where}`** in `TAILOR_SCHEMA`: important JD
  keywords the master already covered, so **coverage** =
  (present + injected) / (present + injected + skipped). Prompt line:
  "keywords.present: important job keywords the resume already covered
  before your edits, and where."
- **Human locations.** Parts get labels from `resume-doc.ts` groups:
  `summary` → "Summary", `r1.b2` → "<Company/role heading> · bullet 3",
  `skills.*` → "Skills · <line name>". Computed in the bridge and sent as
  `labels: Record<id, string>` with the result. The UI never shows raw ids.
- **Question labels for answers.** `answers` today are `{fieldId, value}`;
  the report keeps the asked `TailorQuestion` (label, options) beside each
  so the UI and chat can show "Why do you want to work here?" not `q1`.
- **`report.json` gains** `applicationId`, `job {title, company, url}`,
  `labels`, `questions`, `present`, so a folder is self-describing for the
  bridge (chat after restart) and the dashboard.

## 2. Application state (the thing chat edits)

**One tailoring run = one folder = one chat.** `applicationId` stays
per job URL (dashboard groups runs under it); each run gets a `runId` and
its own folder. A same-day re-run of the same job gets a `-2`, `-3` suffix
instead of overwriting. The index maps `applicationId → runs`, newest
first; the side panel uses the run its tab's `lastRun` names. Pressing ⚡
again on the same page already reuses the tailoring job, so it stays in the
same run and chat.

Per run folder (`~/.applymate/applications/<dir>/`):

- `master.tex` (new): snapshot of `resume-master.tex` at tailoring time.
  Part ids (`r1.b2`) are positions in it, so state, undo, chat after a
  restart and the dashboard all render from the snapshot, never the live
  master.
- `report.json`: the run's report (above), never rewritten by chat.
- `state.json` (new): the **current** overlay:
  `{ edits: Record<partId, latex>, order, coverLetter, answers:
  Record<fieldId, value>, questions, version }`. Starts as the tailoring
  output (`TailorOutcome` must also return the applied `order`, which it
  doesn't today). Resume = `renderResume(parseResume(snapshot), state.edits,
  state.order)`. `version` counts applied changes within this run (panel
  shows "v3").
- **State is the source of truth.** Once chat has changed anything, the
  ⚡ wizard loop reads the current state, not the original tailoring
  output: `/tailor/:id/resume.pdf` and `FETCH_PDF` serve the latest
  version, the cover letter and answers come from state, and the "already
  attached" check compares the version, not just the file name. A later ⚡
  must never quietly undo a chat fix.
- `chat.jsonl` (new): one line per message `{role, text, proposals?,
  applied?: proposalIndex[], at}`.
- `resume.tex/.pdf`, `cover-letter.md`: rewritten on each applied change.
  Each applied resume change also adds a `resume_versions` row (table
  exists) so the dashboard has versions.

The bridge finds a folder by `applicationId`/`runId` (index built from
`report.json` files at startup + updated on save).

**Wizard answers belong to the run.** In wizard mode tailoring starts with
`fields: []` and each later step's answers come from `/answer`. `/answer`
requests carry the run's `tailorJobId`; the bridge links that job to its
run (immediately if tailoring has finished, otherwise when it does) and
merges each step's questions + answers into `state.json`. So the Answers
tab and `answer:<fieldId>` proposals cover every step, not just single-page
forms.

## 3. Chat

### 3.1 Route

`POST /chat/:applicationId` `{ message }` → streams **NDJSON** over a
chunked response:

```
{"t":"delta","text":"The ending is weak because…"}
…
{"t":"done","reply":"…full prose…","proposals":[Proposal…]}
{"t":"error","message":"…"}          // instead of done, on failure
```

The bridge appends user + assistant messages to `chat.jsonl` on `done`.
One turn at a time per application (second request → 409). Chat turns do
**not** go through the tailoring `JobQueue` (they must not wait behind a
50s tailoring job).

`GET /chat/:applicationId` → `{ messages, state, report }` (side panel
reopen, dashboard).

### 3.2 Prompt

System: coach role, untrusted-JD line, talk-first (2–6 sentences,
honest, push back on unsupported asks), proposals block format, LaTeX
rules, never-invent rules, char budget per part. Context (stable order,
history last): JD, current resume parts with labels and `(max N chars)`
(N = master part length, as in tailoring), current cover letter, asked
questions with options and current answers, experience corpus, profile,
then the conversation (last 20 messages; older dropped).

`model`/`effort` reuse `APPLYMATE_MODEL` / `APPLYMATE_EFFORT`.

### 3.3 Proposals

```
Proposal = { target: string; after: string; why: string }
target ∈ resume part ids in the doc | "cover-letter" | "answer:<fieldId>"
```

Validated in the bridge before streaming `done`:
- unknown target → dropped, noted in reply footer;
- `answer:<fieldId>` only for fieldIds asked in this application; if the
  question has options, `after` must be one of them verbatim;
- resume `after`: `latexProblem` (reject), `editWarnings`, `droppedItems`,
  `keywordWarnings` → attached as `warnings[]` on the card (warn, don't
  block, same philosophy as tailoring);
- strip echoed `[id]` labels (reuse `stripIdLabel`).

Proposal cards show: location label, word-level diff (before = current
state, not master), why, warnings, [Apply] [Dismiss]. A malformed block →
reply shown, "Couldn't read Claude's proposed changes — ask again".

### 3.4 Apply

`POST /chat/:applicationId/apply` `{ messageIndex, proposalIndex }`:

- **Resume**: overlay → render → compile → fit check (same `fits()` as
  tailoring: one page AND height ≤ master + 1 line; if the run already
  ended taller than that, the bar is "no taller than the current state",
  so a change that doesn't add height is never refused). Doesn't fit → 409
  `{reason: "N lines too long"}`, state unchanged; card shows it with a
  "Ask for shorter" button that sends a canned message. Fits → save
  state/tex/pdf, new version row, return `{ pdfUrl, fileName, version }`.
- **Cover letter**: save; if the run wanted a cover-letter PDF, recompile it.
- **Answer**: save.
Then the side panel tells the page (§4.2).

Undo: each applied card gets [Undo] (re-applies the previous value through
the same path).

## 4. Surfaces

### 4.1 Side panel (primary)

Two zones, top fixed, chat scrolls:

```
┌───────────────────────────────────────┐
│ Staff AI Engineer · BSC Analytics   ●  │  bridge dot
│ JD coverage ██████░░ 14/19   v3  1pg   │
│ [Keywords] [Changes 6] [Letter] [Answers 2] [Warnings 2] │ tabs/accordion
│  ✓ kubernetes → RBC · bullet 2         │
│  ✗ rust — no experience in corpus      │
│  ● terraform — already on resume       │
├───────────────────────────────────────┤
│ you: RBC bullet 2 sounds inflated      │
│ claude: Agreed, "led" overstates…      │ streams
│  ┌ RBC · bullet 2 ─────────────────┐   │
│  │ -Led- Drove migration of…        │   │ word diff
│  │ ⚠ none      [Apply] [Dismiss]    │   │
│  └──────────────────────────────────┘  │
│ [ Ask or suggest…               ⏎ ]   │
└───────────────────────────────────────┘
```

- Bound to the active tab's last run (`lastRun:<tabId>` already exists;
  it carries `result.applicationId`). No run yet → "Press ⚡ on the
  application page" + the existing paste-JD box.
- Clicking a keyword/change scrolls/opens its detail; "Ask about this"
  on any item pre-fills the composer ("Why did you skip Rust?").
- Paste-JD override and bridge pairing move to a small settings
  disclosure at the bottom.
- Side panel fetches the bridge directly (extension page, same token via
  `bridgeFetch`) to read the stream; the service worker is not in the
  streaming path.

### 4.2 Page sync (content script)

New messages from side panel → tab (`chrome.tabs.sendMessage`, all frames):

- `REATTACH_RESUME { applicationId, version }` → content script fetches the
  PDF via background `FETCH_PDF` (extended to take a version/app id),
  finds the resume file input in the current step, `attachFile`. Not on
  this step (wizard already past it) → responds `not-found`; panel shows
  "Resume step isn't on screen. Go back to it and press ↻ Re-attach, or
  [Download PDF]".
- `REFILL_ANSWER { fieldId, value }` → `applyFill` on the stamped field;
  chat-applied values are explicit user intent, so they overwrite and are
  then marked touched. Field not on the current step (wizard moved on) →
  `not-found`; the panel says "That question is on an earlier step. Go
  back to it and the new answer fills in" (the content script refills
  from state when that step is scanned again).
- `REFILL_COVER_LETTER { text, pdfVersion? }` → fills the cover-letter
  textarea if present and/or re-attaches the cover-letter PDF.

### 4.3 Widget (on page)

Slimmed to: job line, JD source, keyword chips input, ⚡ button, progress
lines, a one-line result ("Tailored · coverage 14/19 · 2 warnings") and
**Review & chat →** (opens the side panel; `OPEN_SIDE_PANEL` exists). The
injected/skipped chip dump moves to the panel.

### 4.4 Dashboard

Application detail page gains: header (title, company, status, coverage),
the same report sections as the panel (read-only), version list with
per-version PDF, and the chat transcript (read-only, proposals shown with
applied/dismissed state). Reads `report.json`/`state.json`/`chat.jsonl`
via the folder path (DB gains a `saved_to` column on `applications`).
Status editing (interview/rejected/ghosted) is out of scope here.

## 5. Visual design

The user asked for a real design pass with the `impeccable`,
`frontend-design` and `ui-ux-pro-max` skills. Both the panel (Vite + React
+ Tailwind) and dashboard (Next + Tailwind) already use Tailwind; one shared
token set (colors, type scale, spacing, diff colors, status colors) applies
to both, light + dark. The panel is ~360–400px wide: dense but legible,
no horizontal scroll, keyboard-first composer (Enter sends,
Shift+Enter newline).

**Mockup gate (hard stop).** Before any panel/dashboard UI code: static
HTML mockups of the panel (no run, report, streaming reply, proposal card
states: pending / applied / refused-too-long / warning) and the dashboard
detail page, shown to the user in the browser. Build starts after they
pick/adjust. Bridge and data work (§1–3) can proceed before the gate.

## 6. Already shipped (this session)

Resume/folder naming: `TAILOR_SCHEMA` gained `job {title, company}`;
filenames, folders and DB rows use Claude's read of the JD, falling back to
the scraped page values (the generic extractor grabbed the first `<h1-3>`,
e.g. "Key Responsibilities", "Step 1 of 3").

## 7. Calls made after the builder check (not discussed with the user)

1. Wizard per-step answers are part of the run's state and chat (§2).
2. Re-tailoring a job makes a new run with its own folder, state and chat;
   same-day re-runs get a suffix instead of overwriting (§2).
3. Chat state is the source of truth for later ⚡ presses (§2).
4. Each run snapshots the master; ids resolve against the snapshot (§2).
5. Fit bar relaxes to "no taller than now" for runs already over (§3.4).
6. Mockups are a hard gate before UI code (§5).

## 8. Left to the builder

Component structure and whether panel/dashboard share a UI package; word
diff implementation (small LCS, no dependency unless trivial); NDJSON
reader details; how `labels` are derived from group headings; index
structure for `applicationId → folder`; test layout (follow existing
`tests/` split). Each new bridge route and the proposal validator get
unit tests with a fake `claude` runner, like `tailor-job.test.ts`.
