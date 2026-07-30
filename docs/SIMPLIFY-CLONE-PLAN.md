# Plan: Close the Gap to Simplify Copilot (Paid Tier) — Local, Zero-API

Date: 2026-07-03. Handoff target: Fable. Baseline: branch `phase-6-completion`,
after G1–G5 from `docs/GAP-ANALYSIS.md` are merged (content-script registration,
React-safe autofill, extended field vocabulary, manual-LLM path, in-memory
retrieval fallback all landed per recent commits).

This is a **delta plan**, not a rewrite. Read `docs/GAP-ANALYSIS.md` first —
it covers the "make the current pipeline actually work" gaps (G1–G6). This doc
covers the next layer: **feature parity with Simplify's paid Copilot tier**,
scoped to what's achievable with zero API cost (Claude Pro via manual
copy/paste, everything else local).

---

## 1. Research findings on how Simplify actually works (verified, sourced)

Confidence-gated via adversarial 3-vote verification; only claims that
survived are listed.

| Claim | Source |
|---|---|
| Simplify supports 100+ job boards/ATS platforms (Workday, Greenhouse, iCIMS, Taleo, Avature, Lever, SmartRecruiters) with auto-detection surfaced via an extension popup icon that appears only on supported pages | simplify.jobs/copilot |
| Autofill maps stored profile data to form fields; AI generates tailored one-click draft answers to custom questions (e.g. "why are you a good fit") that the user reviews before submitting | simplify.jobs/copilot, Chrome Web Store listing |
| Resume tailoring scores a resume against a specific JD and surfaces **missing keywords** for the user to address (JD-to-resume keyword gap analysis) — this is a distinct UI moment, not just silent injection | Chrome Web Store listing |
| Both a tailored ATS-friendly resume **and** a personalized cover letter are generated per application | Chrome Web Store listing |
| Autofill/form-field discovery in comparable open-source clones is XPath/CSS-based and **site-specific** — every ATS needs its own selector set, not one generic scraper (WorkPls: Lever+Greenhouse only, hardcoded selectors) | github.com/jeffistyping/workpls, github.com/berellevy/job_app_filler |
| React-controlled inputs require bypassing React's value tracker: get the native `HTMLInputElement.prototype.value` setter via `Object.getOwnPropertyDescriptor`, call it, then dispatch a bubbling `input`/`change` event — plain `.value =` assignment is silently reverted | coryrylan.com (canonical technique), dev.to |
| Closest architectural analog (ApplyEase): FastAPI + Postgres/pgvector backend, MV3 extension, **local** SentenceTransformer embeddings (all-MiniLM-L6-v2, 384-dim) instead of a hosted embedding API — validates ApplyMate's existing local-embeddings choice | github.com/sainikhil1605/ApplyEase |

Notably **refuted** (don't build toward these — insufficient evidence or
directly contradicted): claims of a "12-node LangGraph pipeline," a
multi-source "career vault" RAG system, or that any competitor runs fully on
a local LLM for custom-question answers. Simplify's actual architecture past
the marketing page is closed-source and unverifiable — everything above the
table is inference from clones and DOM-manipulation literature, not decompiled
Simplify code. Treat as "what a system doing this job looks like," not ground
truth about Simplify's internals.

---

## 2. What ApplyMate already has (don't rebuild)

- Per-board detectors: LinkedIn, Indeed, Greenhouse, Lever, Ashby, Workday +
  generic fallback (`packages/extension/src/content/detectors/`)
- React-safe autofill (native setter + dispatch, per G2) with select/checkbox/
  radio support and field highlighting for unmapped fields
- Extended field vocabulary (first/last name, location, work auth, salary,
  LinkedIn/GitHub/portfolio URLs) mapped in `buildFillPlan`
- 5-stage local pipeline: parse-jd → retrieve (pgvector or in-memory KNN
  fallback, local MiniLM embeddings via `@xenova/transformers`) → anchor-
  validated rewrite → LaTeX assembly (local `tectonic` binary) → cover letter
- Manual-LLM path: side panel builds a self-contained prompt, user pastes into
  claude.ai (Pro plan), pastes response back, `pnpm skill:manual` runs the
  **same code-side invariant validators** — the anchor-validation safeguard
  never depends on the LLM being trustworthy
- Dashboard: applications board, resume version diffs, JD archive, analytics,
  never-auto-submit enforced end to end

This already matches or exceeds most open-source Simplify clones found in
research. The remaining gap is **breadth and UX polish**, not core mechanics.

---

## 3. Gaps to close for Simplify-tier parity

### P1 — Job board coverage is too narrow (highest leverage)
Simplify's headline feature is "it just works everywhere." ApplyMate covers 6
named ATS + a weak generic fallback (`generic.ts`: fires on >=3 form elements
and >500 chars of HTML — this is a smoke detector, not a scraper; it detects
*that* a form exists, not *what* the fields mean beyond the existing 12-field
vocabulary heuristics).

**Action:**
1. Add detectors for the next tier of common ATS platforms, ranked by
   observed prevalence in the research (iCIMS, Taleo, SmartRecruiters,
   Workable, BambooHR, SuccessFactors, Jobvite, Avature). Each detector is
   ~50–100 LOC following the existing pattern in `detectors/workday.ts`:
   URL/DOM fingerprint → `DetectionResult` with confidence.
2. Each new board needs its own extractor entry under
   `content/extractors/boards/` (JD text location + form field DOM shape
   differ per ATS — this is the same lesson WorkPls and job_app_filler both
   hit: no universal selector works across ATS vendors).
3. Strengthen `generic.ts` so unlisted boards still extract *something*
   useful instead of a 0.3-confidence stub: reuse the existing 12-field
   keyword/label heuristics from `field-mapping.ts` against any `<form>` on
   the page, not just named boards. This is the fallback that makes
   "thousands of job boards" plausible without writing thousands of
   detectors.
4. Track detector coverage as a living list in `lib/shared/constants.ts`
   (board name → detector file → last-verified-working date) so regressions
   are visible.

### P2 — No MutationObserver for dynamically injected fields
LinkedIn Easy Apply and Workday both render multi-step modals where fields
appear after the initial DOM snapshot (step 2, step 3 of a wizard). Current
re-extraction is triggered only on side-panel open (per G1 fix), which misses
fields injected *after* the panel is already open and the user advances a
step.

**Action:** add a `MutationObserver` in `content.ts` scoped to the detected
form container, debounced (e.g. 400ms), that re-runs field extraction and
pushes a delta to the side panel via the existing messaging channel
(`utils/messaging.ts`). Cap observer lifetime to the tab session; disconnect
on page navigation.

### P3 — No JD-match / keyword-gap UI moment
Simplify's resume tailoring flow shows the user *which keywords are missing*
before generating — a visible, low-trust-cost feedback step, distinct from
the final anchor-validated output. ApplyMate's pipeline goes straight from
JD parse to rewrite; there's no intermediate "here's your keyword coverage"
screen.

**Action:** surface `parsedJD.keywords` vs. the keywords already present in
the loaded master resume (simple set diff, no LLM needed — this is
`packages/skill/src/stages/parse-jd.ts` output compared against a local
keyword-extraction pass over `resume-master.tex`) as a side-panel step
*before* the user triggers tailoring. This builds trust and gives the user a
manual override point, matching the PRD's plausibility-report-before-generation
principle already used elsewhere in this repo.

### P4 — Custom-question answers are mapped but not AI-suggested standalone
Current `custom-q` field type is filled from whatever the 5-stage pipeline
already produced. Simplify treats "why are you a good fit for this role"
style questions as their own one-click AI-answer feature, independent of
resume generation — useful when the user only wants form-fill, not a full
resume regen.

**Action:** decide whether this is in scope. If yes: extend the manual-LLM
prompt builder (`lib/manual-prompt.ts`) to optionally include detected custom
questions and have the pasted-back response include short-answer drafts,
validated against the same anchor corpus (no new hallucination-injection
surface — reuse `invariant-checks.ts`).

### P5 — Docs drift (carried over from G6, still open)
`CLAUDE.md`/`README.md` describe a directory layout (`packages/skill/stages/`,
`packages/skill/apply-to-job.skill.ts`) that doesn't match the real code
(`packages/skill/src/stages/`, `packages/skill/src/index.ts`). Fix before
handoff — Fable will otherwise navigate to files that don't exist.

---

## 4. Non-goals (explicitly out of scope, matches existing README constraints)

- No headless/bot-driven auto-apply (Simplify doesn't auto-submit either;
  ApplyMate's hard constraint is the same, keep it)
- No cloud sync, no hosted LLM API calls, no telemetry
- No attempt to reverse-engineer or scrape Simplify's actual extension code —
  everything above is independently-verified public documentation +
  open-source analogs, not decompilation

## 5. Suggested build order

1. P5 (docs) — cheap, unblocks anyone else reading the repo correctly.
2. P1 generic-fallback strengthening (reuse existing heuristics — no new
   detector files yet, immediate coverage lift on unlisted boards).
3. P1 named detectors for iCIMS + Workable + SmartRecruiters (pick 3 highest-
   value first, validate pattern, then batch the rest).
4. P2 MutationObserver (fixes a real "why didn't it fill step 2" bug class).
5. P3 keyword-gap UI step (trust-building, no backend changes needed —
   pure UI + existing parse-jd output).
6. P4 custom-question standalone answers (only if user wants form-fill-only
   flows independent of full resume regen).

Each item is independently shippable and testable; no item blocks another
except P5 should land first so file references in PRs are correct.
