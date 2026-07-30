# Gap Analysis — ApplyMate vs PRD (`~/Downloads/01-applymate-prd.md`)

Date: 2026-07-03. Baseline: branch `phase-6-completion` at `df94e25` plus
uncommitted content-script registration fix.

## Reading the PRD under the local-only constraint

The PRD specifies a cloud stack (Supabase + pgvector, Vercel, Gemini/Groq
routing, GitHub OAuth). The owner's hard constraint overrides that stack:
**zero recurring API cost, no paid LLM API, everything runs locally**, with an
optional manual copy/paste step so LLM generation can go through the owner's
Claude Pro subscription in the browser. This repo already made that
translation (documented in `README.md` / `CLAUDE.md`):

| PRD component | Local equivalent in this repo |
|---|---|
| Supabase Postgres + RLS | SQLite via `node:sqlite` (`lib/local/db.ts`), single user |
| Vercel API routes | Local bridge server (`packages/bridge`, port 4179, bearer token) |
| Gemini/Groq LLM router | Claude Code skill `/apply-to-job` (Pro plan, local) |
| gemini-embedding-001 | `@xenova/transformers` MiniLM embeddings, fully offline |
| pgvector (managed) | pgvector in local Docker Postgres |
| Tectonic-WASM | Local `tectonic` binary via dashboard `/api/compile` |
| GitHub OAuth | None needed (single local user) |

Gaps below are measured against the PRD's *functional* end state (one click →
every field filled + ATS-optimized anchored resume), not its cloud stack.

## What already works (verified 2026-07-03)

- Extension builds (`vite`), 45/45 extension tests pass, bundle loadable
  (manifest + `content.js`/`background.js`/`side-panel.*` in `dist/`).
- Detection + JD extraction for LinkedIn, Indeed, Greenhouse, Lever, Ashby,
  Workday, plus generic fallback (PRD §10 scrapers — exceeds v1 scope).
- Form field extraction with label/placeholder heuristics (PRD §10 pass 1).
- Side panel 4-step flow: data review → form validation → tailoring review →
  auto-fill; manual entry fallback for low-confidence detection.
- 5-stage pipeline (`packages/skill`): parseJD → retrieve (pgvector + local
  embeddings) → anchor-validated rewrite → LaTeX assembly → cover letter,
  with invariant checks + plausibility scoring (PRD §9) and an
  accuracy-guard test proving hallucinations are blocked.
- Bridge server with bearer token, loopback-only host check, extension-origin
  CORS; persists applications/resume versions/JD archive to SQLite.
- Dashboard: applications board + detail, resume diff, JD archive, analytics,
  `/api/compile` (tectonic → PDF). Builds clean.
- Never-auto-submit enforced end to end (PRD §4 non-goal).

## Gaps

### G1 — Content script was never registered (critical; the "not working" bug)
`manifest.json` had no `content_scripts` entry, so nothing ever ran on job
pages: no extraction, no side-panel data, no fill. Fixed in the uncommitted
work (registration + panel-open re-extract for SPA forms). **Action: verify,
clean stray README edit, commit.**

### G2 — Autofill fails on React-controlled forms (critical)
`fill.ts` assigns `element.value` directly. Greenhouse/Ashby/Lever/Workday
forms are React/controlled; React reads values through its own value tracker,
so a plain `.value =` assignment followed by `dispatchEvent` is ignored and
the value visually reverts on first render. PRD §4 targets ≥90% autofill on
exactly these portals. Also no handling for `select`, `checkbox`, or `radio`
fields. **Action: use the native value setter
(`HTMLInputElement.prototype.value` descriptor), handle select option
matching + checkbox/radio, per-type events.**

### G3 — Field vocabulary too narrow to "fill every field" (critical)
Only `name / email / phone / resume / cover-letter / custom-q` exist.
Real Greenhouse/Lever forms ask first name + last name separately, LinkedIn
URL, GitHub, portfolio/website, location/city, work authorization,
salary expectations (PRD §8 `profiles`, §10 `semantic_role` list). The
`Profile` type already stores linkedin/github/website but the mapper never
uses them. **Action: extend value types + keywords + profile fields
(first/last split, location, work auth, salary), map them in
`buildFillPlan`, highlight unmapped fields on the page (PRD user story:
"unrecognized fields highlighted in yellow").**

### G4 — No manual LLM path (constraint violation)
The only generation path is the `/apply-to-job` skill inside Claude Code. The
owner's constraint requires an *optional manual* path: copy a prompt, paste it
into claude.ai (Claude Pro in the browser), paste the response back, and have
the local code validate/assemble/publish. **Action: (a) "Copy prompt" in the
side panel that builds a complete self-contained prompt from the extracted
JD + form fields; (b) `pnpm skill:manual` CLI that reads the pasted LLM JSON,
runs the same invariant validators, assembles LaTeX + cover letter, and POSTs
to the bridge. The validator stays in code — the safeguard never depends on
the LLM.**

### G5 — Retrieval hard-requires Docker Postgres (friction + broken tests)
`pnpm test:skill` fails out of the box: `pgvector.test.ts` / `retrieve.test.ts`
error when Postgres isn't running. Embeddings are already local
(`@xenova/transformers`); only the KNN store needs pgvector. For a
single-user corpus (~dozens of anchors) an in-memory cosine search is
equivalent. **Action: in-memory retrieval fallback used automatically when
Postgres is unreachable; DB-backed tests skip (not fail) without a DB.**

### G6 — Docs drift
`CLAUDE.md`/`README` describe files that don't exist (`popup.tsx`,
`skill/stages/1-parse-jd.ts` naming, npm vs pnpm), README has a stray `1`,
and exact local run steps (bridge token, tectonic install, manual-LLM flow)
are incomplete. **Action: rewrite README quickstart; record non-obvious
choices in `docs/DECISIONS.md`.**

### Accepted deviations from the PRD (intentional, documented)
- No Supabase/Vercel/OAuth/PostHog/Upstash — replaced by local equivalents
  (zero-cost constraint).
- No Tectonic-WASM — local `tectonic` binary through the dashboard API
  (prior phase found self-hosting the WASM assets impractical; see git
  history `fd3c8a7`, `e374682`).
- No LLM provider router / rate limiting — no API calls exist at all.
- PDF preview lives in the dashboard, not the extension side panel.
- Cover-letter style picker (formal/casual/story/direct) folded into the
  skill prompt + `~/.applymate/generation-directives.md` rather than UI.

## Fix plan (dependency order)

1. Commit G1 (content-script registration, cleaned).
2. G5 — in-memory retrieval fallback; green `pnpm test:skill` without Docker.
3. G2 + G3 — autofill correctness + field coverage (+ yellow highlight).
4. G4 — manual LLM path (copy-prompt UI + `skill:manual` CLI).
5. G6 — README + DECISIONS.md.
6. Full verification: all tests, both builds, extension load check, E2E with
   manual-LLM step.
