# CLAUDE.md

Guidance for Claude Code working in this repo.

## Project: ApplyMate

Local, zero-API-cost clone of Simplify Copilot's paid tier. One click on a job
application page fills every standard field instantly, then attaches a
Claude-tailored one-page resume PDF, a cover letter, and custom-question
answers (~50-60s later). **Never submits** — the user clicks the site's Submit;
ApplyMate only notices that click to mark the application `applied`.

Roadmap: sub-project 1 (one-click core) is built. Next: #2 multi-step ATS
(Workday, LinkedIn Easy Apply, iCIMS/SmartRecruiters/Taleo, custom widgets),
#3 AIApply side (match-score badges, pre-tailor queue, dashboard tracker,
profile/answers editor UI). Specs/plans live in `docs/superpowers/`.

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

## Commands

```bash
pnpm install
pnpm profile:init        # writes ~/.applymate/profile.yaml (never overwrites)
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
| `profile.yaml` | Autofill values + `answers:` regex rules for repeat questions |
| `bridge-token`, `paired-extension` | Bearer token (persistent) and the TOFU-paired extension origin |
| `applications/<date>-<co>-<role>/` | `resume.tex/.pdf`, `cover-letter.md`, `report.json`, `jd.md` |
| `app.db` | SQLite for the dashboard (applications, versions, JD archive) |
| `bridge.log` | launchd stdout/stderr |

## Key files

| File | Purpose |
|---|---|
| `packages/extension/src/content/content.ts` | Gating, `runOneClick`, submit detection, SPA/field watchers |
| `packages/extension/src/content/widget.ts` | Shadow-DOM widget (all dynamic text escaped) |
| `packages/extension/src/content/extractors/form.ts` | Live-DOM fields, label resolution, value-type inference |
| `packages/extension/src/content/fill.ts` | Fill text/select/radio/checkbox/combobox/radiogroup, `matchOption`, file attach |
| `packages/extension/src/lib/field-mapping.ts` | Profile → field values, answer rules |
| `packages/extension/src/background.ts` | Proxies bridge calls (pairing, tailor, poll, PDFs, applied) |
| `packages/skill/src/tailor/` | `resume-doc` (ID-addressed parts), `prompt`, `claude-cli`, `checks`, `run` (orchestrator), `letter` |
| `packages/bridge/src/server.ts` | Routes: `/pair`, `/tailor`, `/tailor/:id[/resume|cover-letter.pdf]`, `/profile`, `/applications/applied` |
| `packages/bridge/src/tailor-job.ts` | Reads `~/.applymate`, runs tailoring, saves, names the PDF |
| `lib/local/compile-latex.ts` | tectonic + pdfLaTeX compat shim + page/height probe |
| `lib/shared/constants.ts` | Field keyword table, autocomplete map, board patterns |

## Constraints (do not break)

- Never click or trigger a site's submit.
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

## Legacy code (pending deletion, ask the user first)

The old copy/paste flow and 5-stage pipeline are unused by the one-click path:
`packages/skill/src/{stages/retrieve.ts,db/,embeddings/,manual/,cli/manual.ts}`,
`packages/skill/{apply-to-job.md,docker-compose.yml,db/schema.sql}`, the
`%%BULLETS%%` template path in `stages/assemble-latex.ts`, and the bridge's
`/output` routes. `escapeLatex` in `assemble-latex.ts` is still used by
`tailor/letter.ts` — move it before deleting.
