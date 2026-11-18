# CLAUDE.md

Guidance for Claude Code working in this repo.

## Project: ApplyMate

Local, zero-API-cost clone of Simplify Copilot's paid tier. One click on a job
application page fills every standard field instantly, then attaches a
Claude-tailored one-page resume PDF, a cover letter, and custom-question
answers (~50-60s later). **Never submits** — the user clicks the site's Submit;
ApplyMate only notices that click to mark the application `applied`.

On multi-step wizards (Workday, LinkedIn Easy Apply, SuccessFactors/Taleo/
iCIMS-style) the same click fills each step, presses Next/Continue/Save and
Continue, and stops on the review page whose button is Submit.

Roadmap: #1 one-click core and #2 multi-step ATS are built. Next: #3 AIApply
side (match-score badges, pre-tailor queue, dashboard tracker, profile/answers
editor UI). Specs/plans live in `docs/superpowers/`.

## How it works

```
content script (every frame, classic IIFE)          background SW            bridge (launchd, 127.0.0.1:4179)
  widget (shadow DOM) ── ⚡ click ──────────────────► proxy fetch ───────────► POST /tailor → JobQueue (FIFO)
  1. extract fields from live DOM (data-applymate-id)                            claude -p (subscription, JSON schema)
  2. instant fill from profile (+ answer rules)                                  → splice edits into resume-master.tex
  3. poll GET /tailor/:id every 2s ◄──────────────── proxy ◄──────────────────   → warn-only checks
  4. attach PDF (DataTransfer), fill Claude answers                              → tectonic compile + page fit
  5. re-apply profile values (resume parsers overwrite)                          → ~/.applymate/applications/<date-co-role>/
  6. user clicks Submit → MARK_APPLIED ───────────────────────────────────────►  + SQLite (dashboard)
side panel (report + chat) ── GET/POST /chat/:runId (NDJSON) ───────────────────►  claude -p turn → validated proposals
  Apply/Undo ── POST /chat/:runId/apply ────────────────────────────────────────►  recompile (one page) → state.json v+1
  page sync (content script): REATTACH_RESUME / REFILL_ANSWER / REFILL_COVER_LETTER
```

- **JD sourcing** (`lib/jd-cache.ts`): pasted override → JD on page → JD cached
  from the posting page (same job key; Lever `/apply`, Ashby `/application`) →
  most recent JD within 30 min (iframes) → none (keywords only).
- **Keywords**: widget chips, sticky across jobs; sent as priority keywords.
- **Tailoring** is judgment-led: Claude may reframe adjacent real work; code
  checks only *warn* (invented/dropped metrics, seniority, keywords not in
  corpus, dropped skills). Only LaTeX that breaks compilation is reverted.
- **Page fit**: one page AND natural height ≤ master + one line (`\pagetotal`
  probe). Otherwise largest-growth edits revert, then an add-back pass.
- **Wizard loop** (`runOneClick`, max 15 steps): scan the step (inside an open
  apply dialog if any) → Workday adapter (Add entries per `profile.work`/
  `education`, date spinners, self-identify date) → instant fill → on a resume
  step await tailoring and attach → unanswered questions: single page from the
  tailoring call, wizard steps from `POST /answer` (answers-only `claude -p`,
  ~10s; dropdown buttons are opened once so Claude sees their options) → empty
  required → pause · Submit visible → stop "Ready for review" · else press the
  advance button and wait for the step to change (unchanged → pause with the
  page's errors). Pressing ⚡ again resumes on the current step, reuses the
  tailoring job, and never overwrites fields the user edited.
- **Run folder** (`lib/local/runs.ts`): each run's dir holds `master.tex`
  (snapshot), `report.json` (written once, never rewritten), `state.json`
  (source of truth for current edits/order/cover letter/answers/questions/
  version) and `chat.json`. `GET /tailor/:id` is overlaid with `state.json`;
  `POST /answer` takes `tailorJobId` to merge wizard answers into the run.
- **Review & chat**: widget is slim + "Review & chat →"; the side panel shows
  the report (`buildRunView`) and a chat whose replies may carry proposals
  (resume edits, cover letter, answers). Proposals are validated server-side
  (`proposals.ts`) and applied only on the user's Apply/Undo; each apply
  recompiles with the page-fit rule, bumps `version`, and the page re-syncs
  (re-attach PDF, refill answers). One turn at a time per run (409 busy).
  Dashboard detail shows runs, versions, report, transcript (`getRuns`). Spec:
  `docs/superpowers/specs/2026-11-16-review-and-chat-design.md`; approved
  mockups: `docs/superpowers/mockups/review-chat/`.
- **Claude never answers** lone checkboxes (consent/terms/opt-ins) or fields
  that already hold a value; only answers for asked fields are applied.

## Commands

```bash
pnpm install
pnpm profile:init        # writes ~/.applymate/profile.yaml (never overwrites)
pnpm profile:sync        # claude -p fills empty work/education/skills/languages lists
pnpm bridge:install      # launchd agent: bridge at login, restarts on crash
pnpm bridge              # or run the bridge in the foreground
pnpm bridge:unpair       # let a re-installed extension pair again
pnpm tailor:smoke [jd]   # real end-to-end: claude -p + tectonic on your files
pnpm build:extension     # dist/ → chrome://extensions → Load unpacked / ↻
pnpm dev:dashboard       # http://localhost:3000

pnpm test && pnpm test:skill && pnpm test:bridge     # extension / engine / bridge
(cd packages/dashboard && npx vitest run)            # dashboard + real tectonic compile
pnpm type-check && pnpm type-check:skill && pnpm type-check:bridge
```

After changing bridge code: `launchctl kickstart -k gui/$(id -u)/com.applymate.bridge`.
After changing extension code: rebuild, then ↻ reload at `chrome://extensions`.

## Local files (`~/.applymate/`)

| File | Role |
|---|---|
| `resume-master.tex` | Single source of truth. Read-only to ApplyMate. pdfLaTeX-flavoured (Overleaf) — compiled via the tectonic compat shim |
| `experience.yaml` | Ground-truth corpus Claude tailors from |
| `generation-directives.md` | Audience profiles (FAANG/startup/enterprise/AI/platform) |
| `profile.yaml` | Autofill values, `work`/`education`/`skills`/`languages` lists (most recent first), `answers:` regex rules for repeat questions |
| `bridge-token`, `paired-extension` | Bearer token (persistent) and the TOFU-paired extension origin |
| `applications/<date>-<co>-<role>/` | `resume.tex/.pdf`, `cover-letter.md`, `jd.md`, `master.tex` (snapshot), `report.json` (immutable), `state.json` (current edits/version), `chat.json` (transcript) |
| `app.db` | SQLite for the dashboard (applications, versions, JD archive) |
| `bridge.log` | launchd stdout/stderr |

## Key files

| File | Purpose |
|---|---|
| `packages/extension/src/content/content.ts` | Gating (incl. apply dialogs), `runOneClick` wizard loop, submit detection, SPA/field watchers |
| `packages/extension/src/content/wizard.ts` | `activeScope`, `findStepButton` (submit wins), `stepSignature`, `waitForStepChange`, `visibleErrors` |
| `packages/extension/src/content/adapters/workday.ts` | Repeating Add sections, date spinbuttons, self-identify date |
| `packages/extension/src/content/widget.ts` | Shadow-DOM widget (all dynamic text escaped); slim, coverage + "Review & chat →" |
| `packages/extension/src/content/page-sync.ts` | Handles `REATTACH_RESUME`/`REFILL_ANSWER`/`REFILL_COVER_LETTER` after a chat apply; skips fields the user edited |
| `packages/extension/src/ui/` | Side panel: `ReportPanel`, `ChatThread`, `ProposalCard`, `Composer`, `Diff`; `lib/use-chat.ts`, `ndjson.ts`, `page-sync.ts` |
| `packages/extension/src/content/extractors/form.ts` | Live-DOM fields, label resolution, value-type inference |
| `packages/extension/src/content/fill.ts` | Fill text/select/radio/checkbox/combobox/radiogroup/dropdown buttons/search prompts, `matchOption`, `readOptions`, file attach |
| `packages/extension/src/content/dom.ts` | Shadow-DOM-aware queries, native setters, press/type sequences |
| `packages/extension/src/lib/field-mapping.ts` | Profile → field values, answer rules |
| `packages/extension/src/background.ts` | Proxies bridge calls (pairing, tailor, poll, PDFs incl. `FETCH_RUN_PDF`, applied), opens the side panel |
| `packages/skill/src/tailor/` | `resume-doc` (ID-addressed parts), `prompt`, `claude-cli`, `checks`, `run` (orchestrator), `letter`, `answer` (answers-only), `chat` (prompt + reply split), `proposals` (validation), `fit` (page-fit budget) |
| `packages/bridge/src/server.ts` | Routes: `/pair`, `/tailor`, `/tailor/:id[/resume|cover-letter.pdf]`, `/answer`, `/answer/:id`, `/profile`, `/applications/applied`, `/chat/:runId` (GET; POST streams NDJSON, 409 busy), `/chat/:runId/apply` (`{messageIndex, proposalIndex, undo?}`), `/chat/:runId/resume.pdf`, `/chat/:runId/cover-letter.pdf` |
| `packages/bridge/src/chat.ts` | Per-run chat: streamed turn, apply/undo + recompile, version rows; run folder is the only state |
| `packages/bridge/src/profile-sync.ts` | `pnpm profile:sync` (fills only empty profile lists) |
| `packages/bridge/src/tailor-job.ts` | Reads `~/.applymate`, runs tailoring, saves, names the PDF |
| `lib/local/runs.ts` | Write/read run folders, `scanRuns`, `runsForApplication` |
| `lib/shared/run-view.ts`, `word-diff.ts`, `latex-text.ts` | Report view-model, word/marked diff, LaTeX→text; shared by panel + dashboard |
| `lib/ui/tailwind-preset.cjs` | Design tokens shared by extension UI + dashboard (see `PRODUCT.md`) |
| `packages/dashboard/lib/data.ts` | `getRuns`: run report/versions/transcript for the application detail page |
| `lib/local/compile-latex.ts` | tectonic + pdfLaTeX compat shim + page/height probe |
| `lib/shared/constants.ts` | Field keyword table, autocomplete map, board patterns |

## Constraints (do not break)

- Never click or trigger a site's submit. The wizard presses only advance
  controls and stops when a submit control is visible.
- Never automate sign-in/account creation; never auto-check consent/terms
  unless a profile `answers` rule matches the label.
- Zero Anthropic API usage: generation only via `claude -p` on the user's
  subscription. Never `--bare` (forces `ANTHROPIC_API_KEY`). Keep the
  isolation flags + `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` so the user's global
  CLAUDE.md/hooks don't leak into resumes or cover letters.
- `APPLYMATE_MODEL` (default `sonnet`), `APPLYMATE_EFFORT` (default `low`, ~50s).
- Bridge binds 127.0.0.1 only; everything but `/health` and `/pair` needs the
  token; CORS reflects only `chrome-extension://`; pairing is POST (Chrome
  guarantees `Origin` only on non-GET).
- `dist/content.js` must stay a classic IIFE (no top-level `import`) — built by
  `vite.content.config.ts`. An ES-module content script silently never runs.
- Names, contact, companies, titles, dates, education are never exposed to
  Claude for editing (`resume-doc.ts` only exposes summary, bullets, skills).
- Chat proposals never apply themselves; applied resume changes must keep one
  page (refused otherwise).

## History

The earlier copy/paste flow (claude.ai prompt → `pnpm skill:manual`), the
5-stage pgvector pipeline, and the `/apply-to-job` skill were deleted on
2026-09-28 in favor of the one-click path; see git history before `one-click-core`.
