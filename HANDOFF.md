# Handoff: Close Gap to Simplify Copilot Paid Tier (Local, Zero-API)

**Generated**: 2026-07-04
**Branch**: phase-6-completion
**Status**: Ready for Review (P1-P5 shipped and verified; P6+ ideas below not started)

## Goal

Clone the functional core of Simplify Jobs' paid Copilot Chrome extension —
auto-detect job boards, autofill applications, tailor resume with anchor-
validated keyword injection, generate cover letters, track applications — but
running entirely locally with **zero API cost**. LLM generation goes through
the user's existing Claude Pro subscription via a manual copy/paste step
(`claude.ai` in browser), never the Anthropic API. See `CLAUDE.md` for full
architecture and `docs/GAP-ANALYSIS.md` + `docs/SIMPLIFY-CLONE-PLAN.md` for
the prior gap analyses this session executed against.

## Completed

- [x] **P5 — Docs drift**: `CLAUDE.md` rewritten to match real code layout
      (`packages/skill/src/stages/`, pnpm not npm, local `tectonic` binary not
      Tectonic-WASM, no `popup.tsx`/`register:skill`/`test:e2e` — those never
      existed).
- [x] **P1 — Board coverage**: added iCIMS, Workable, SmartRecruiters
      detectors + extractors (9 named boards total). Bigger win: generic
      fallback now parses schema.org `JobPosting` JSON-LD
      (`packages/extension/src/content/extractors/jd.ts:
extractJsonLdJobPosting`) before falling back to regex heuristics — any ATS
      indexed by Google Jobs carries this markup, so **unlisted boards get
      real title/company/description**, not a stub. `lib/shared/constants.ts`
      now has a `BOARD_COVERAGE` map (board → detector file →
      last-verified date) for tracking regressions.
- [x] **P2 — Dynamic fields**: debounced `MutationObserver`
      (`watchForInjectedFields` in `packages/extension/src/content/content.ts`)
      watches `document.body` for injected `input/textarea/select/form` nodes
      and re-extracts. Fixes LinkedIn Easy Apply / Workday multi-step wizards
      where step-2+ fields didn't exist at initial page load.
- [x] **P3 — Keyword-gap UI**: side panel (`TailoringReview.tsx`) shows
      JD keywords covered vs. missing from the master resume, before the user
      triggers generation. New shared vocabulary
      `lib/shared/keywords.ts:extractTechKeywords` (word-boundary matching —
      fixed a pre-existing bug where `"go"` matched `"good"`) used by both
      `packages/skill/src/stages/parse-jd.ts` and the extension. New bridge
      endpoint `GET /resume/keywords` (token-protected) scans
      `~/.applymate/resume-master.tex`.
- [x] **P4 — Answers-only flow**: `buildQuestionsPrompt` in
      `packages/extension/src/lib/manual-prompt.ts` drafts custom-question
      answers without a full resume regen. Second copy button in
      `TailoringReview.tsx` (shown only when custom questions detected).
      `parseManualResponse` now accepts empty `bullets` when
      `formFieldGuidance` is non-empty. `processManualResponse` flags any tech
      keyword in a suggested answer that no corpus anchor backs (pushed into
      `output.rewritingReport.warnings`).
- [x] All new code covered by tests; full verification pass done (see below).

## Not Yet Done

These are from `docs/SIMPLIFY-CLONE-PLAN.md` §3 but were out of this
session's scope (not requested) or are natural next steps:

- [ ] More ATS detectors: BambooHR, SuccessFactors, Jobvite, Avature,
      Taleo — pattern is established (`detectors/icims.ts` is the template),
      each is ~30 LOC detector + ~15 LOC extractor + a few test cases.
- [ ] `BOARD_COVERAGE.icims/workable/smartrecruiters` are marked
      `"unverified"` in `lib/shared/constants.ts` — none of the three new
      detectors have been tested against a live posting, only synthetic
      HTML/URLs in unit tests. Selectors were written from public docs/memory
      of each platform's DOM, not confirmed live.
- [ ] Dashboard-side surfacing of `BOARD_COVERAGE` (e.g. an admin/status page
      showing which boards are verified) — mentioned in the plan, not built.
- [ ] No automated E2E suite exists (removed a stale reference to
      `pnpm test:e2e` from CLAUDE.md rather than building it — it never
      existed). Manual verification steps are in CLAUDE.md's "E2E" section.

## Failed Approaches (Don't Repeat These)

- **Full `/deep-research` workflow with heavy parallel fan-out** — burned
  ~2.4M tokens and 104 subagents in ~6 minutes and hit the session token
  limit mid-run (synthesis step failed: "You've hit your session limit").
  Recovered by reading the partial results file directly
  (`tool-results/btie53it1.txt`) and doing targeted `Bash`/`Read`/`Grep`
  against the actual codebase instead of re-running research agents. **User
  explicitly asked to avoid parallel token-heavy tools going forward** — do
  planning/investigation with direct tool calls, not `Workflow`/`Agent`
  fan-out, unless the user asks for it.
- **`sed -i` with backslash-escaped literal `*` in replacement text** — one
  sed command aimed at fixing "Tectonic-WASM" → "local tectonic binary"
  aborted with `bad flag in substitute command: '\'` because the replacement
  string contained an unescaped `\*\*` sequence. Switched to `Edit` tool calls
  for anything with special characters instead of chaining sed one-liners.

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Generic fallback detects via JSON-LD `JobPosting`, not new named detectors per unlisted board | Matches how competitor "100+ boards" claims are actually achieved — one schema.org parser covers boards a hand-written detector list never will. Confirmed via research (multiple sources cite Simplify supporting 100+ ATS; no clone reverse-engineers that many selector sets by hand). |
| Shared `lib/shared/keywords.ts` instead of duplicating `TECH_TERMS` in the skill package | The skill's `parse-jd.ts` already had its own hardcoded list; extension needed the same list for the keyword-gap view. Duplication would drift. Also fixed a real bug (`"go"` substring-matching `"good"`) while consolidating. |
| Keyword-gap check runs entirely client-side/local (no LLM call) | Matches project's zero-API constraint; it's a plain set-diff against `parse-jd`'s existing keyword extraction, no reason to spend an LLM turn on it. |
| Answers-only flow reuses the *same* manual-LLM validator path (`processManualResponse`), not a separate code path | Anchor-validation safeguard must never depend on which UI button was clicked — reusing the validator means answer-only responses get identical hallucination scrutiny as full resume rewrites. |
| `parseManualResponse` relaxed to accept `bullets: []` only when `formFieldGuidance` is non-empty | Necessary to support answers-only submissions through the same schema/validator without opening a hole for "no bullets, no guidance, nothing to validate" garbage responses. |

## Current State

**Working**: Everything committed and passing. Extension builds
(`packages/extension/dist`), dashboard builds, bridge type-checks. All new
features are wired into the existing side-panel flow — no dead code paths.

**Broken**: Nothing known broken. iCIMS/Workable/SmartRecruiters detectors are
untested against real postings (see Not Yet Done) — could have selector
drift if those platforms' DOM differs from what was assumed.

**Uncommitted Changes**: None — `git status` is clean. 5 commits this
session on top of `6b9de3b`:
```
8c5676c feat: answers-only manual flow for custom questions
bfb52e2 feat: keyword-gap coverage view before tailoring
fa2b48d feat: re-extract fields when ATS wizards inject new form controls
5ae0ff1 feat: iCIMS/Workable/SmartRecruiters boards + JSON-LD generic fallback
4252816 docs: fix CLAUDE.md drift; add Simplify-parity plan
```

## Files to Know

| File | Why It Matters |
|------|----------------|
| `docs/SIMPLIFY-CLONE-PLAN.md` | The plan this session executed against (P1-P5); has the full research citations and remaining P6+ ideas |
| `docs/GAP-ANALYSIS.md` | Prior session's gap analysis (G1-G6) — already resolved before this session started |
| `packages/extension/src/content/extractors/jd.ts` | JSON-LD `JobPosting` parser — the highest-leverage change; understand this before touching board detection |
| `lib/shared/keywords.ts` | Single source of truth for tech-keyword vocabulary; both skill and extension import from here |
| `packages/extension/src/content/content.ts` | `watchForInjectedFields` (MutationObserver) lives here alongside the main extraction entrypoint |
| `packages/extension/src/ui/components/TailoringReview.tsx` | Side-panel step with keyword-gap view + both copy-prompt buttons |
| `packages/skill/src/manual/process.ts` | Manual-LLM validation — anchor-validation safeguard, now also validates answers-only responses |
| `packages/bridge/src/server.ts` | `GET /resume/keywords` endpoint added here |
| `lib/shared/constants.ts` | `BOARD_DETECTION_PATTERNS` + new `BOARD_COVERAGE` tracking map |

## Code Context

**JSON-LD extraction** (the core new capability):
```typescript
// packages/extension/src/content/extractors/jd.ts
export function extractJsonLdJobPosting(html: string): ExtractedContent | null
// Finds <script type="application/ld+json"> containing @type: "JobPosting"
// (handles arrays and @graph wrapping). Returns null if none found or none parse.
```

**Shared keyword extraction**:
```typescript
// lib/shared/keywords.ts
export const TECH_TERMS: readonly string[]
export function extractTechKeywords(text: string): string[]
// Word-boundary regex for alnum-only terms; substring match for terms with
// special chars (c++, c#, next.js, ci/cd) since \b breaks on those.
```

**Bridge keyword endpoint response shape**:
```json
// GET /resume/keywords
{ "keywords": ["rust", "typescript", "postgresql", "docker"] }
// 404 if ~/.applymate/resume-master.tex doesn't exist (or masterResumePath override)
```

**Manual LLM response now supports answers-only** (`packages/skill/src/manual/process.ts`):
```typescript
export interface ManualLLMResponse {
  job: { company: string; jobTitle: string; jobUrl: string; jobDescription: string };
  bullets: RewriteCandidate[];       // may be empty IF formFieldGuidance is non-empty
  coverLetterParagraphs: string[];
  formFieldGuidance?: { fieldId: string; suggestedAnswer: string; relatedBullets?: string[] }[];
}
```

**MutationObserver signature** (testable in isolation):
```typescript
// packages/extension/src/content/content.ts
export function watchForInjectedFields(
  doc: Document,
  onFieldsChanged: () => void,
): MutationObserver
// Debounced 400ms. Disconnects on 'pagehide'.
```

## Resume Instructions

1. Confirm clean state: `git status` → should be clean on `phase-6-completion`.
2. Run full verification before any new work:
   ```
   pnpm test:extension && pnpm test:bridge && pnpm test:skill
   pnpm type-check && pnpm type-check:skill && pnpm type-check:bridge
   pnpm build:extension && pnpm build:dashboard
   ```
   - Expected: extension 62/62 pass, bridge 17/17 pass, skill 48 pass + 3
     skipped (Postgres-backed tests skip without Docker — this is intentional,
     not a failure), all type-checks silent, both builds succeed.
3. To manually verify the new features against a live posting:
   - `pnpm bridge` (prints a bearer token, also saves to
     `~/.applymate/bridge-token`)
   - Load `packages/extension/dist` unpacked in `chrome://extensions`
   - Visit a real iCIMS/Workable/SmartRecruiters career page → open the side
     panel → check whether `detection.board` matches the platform and
     `jobTitle`/`company`/`jobDescription` are populated correctly
   - If board detection fails or extraction is empty: the selectors in
     `detectors/{icims,workable,smartrecruiters}.ts` and
     `extractors/boards/{icims,workable,smartrecruiters}.ts` were written from
     memory of typical DOM structure, not confirmed against a live page —
     inspect the real page's DOM and adjust selectors.
   - Test keyword-gap view: with the bridge running and
     `~/.applymate/resume-master.tex` populated, the "Tailoring Review" step
     should show a coverage count and colored keyword chips before the
     "Waiting for tailored resume…" text.
   - Test answers-only flow: on a posting with a custom question field, the
     "Copy questions-only prompt" button should appear under "Copy Claude
     prompt".
4. Next priority per the plan: pick 2-3 more ATS platforms (BambooHR,
   SuccessFactors, Jobvite are next in `docs/SIMPLIFY-CLONE-PLAN.md` §3 P1)
   and repeat the `detectors/icims.ts` + `extractors/boards/icims.ts` pattern.

## Setup Required

- `~/.applymate/resume-master.tex` must exist for the keyword-gap feature to
  return data (otherwise bridge returns 404 and the UI shows "Keyword
  coverage unavailable").
- `~/.applymate/experience.yaml` (the anchor corpus) needed for any
  manual-LLM validation to run meaningfully.
- Bridge must be running (`pnpm bridge`) for keyword-gap and manual-LLM
  output polling to work; the side panel degrades gracefully (shows
  "unavailable"/"waiting") when it's not.
- Postgres + pgvector is optional — `pnpm skill:db:up` — the in-memory KNN
  fallback (from a prior session's G5 fix) means it's not required for local
  dev or tests.

## Edge Cases & Error Handling

- JSON-LD parsing failure (malformed JSON) → `safeParse` catches and returns
  `null`, falls through to regex heuristics. Covered by test "ignores
  malformed JSON-LD and falls back to heuristics".
- Multiple JSON-LD script blocks, or `JobPosting` nested in `@graph` → handled
  by `findJobPosting`'s recursive search. Covered by test.
- `hiringOrganization` as a bare string vs. an object with `name`/`legalName`
  → both handled in `extractJsonLdJobPosting`.
- Bridge unreachable when checking keyword gap → `fetchResumeKeywords`
  returns `null`, UI shows "Keyword coverage unavailable (bridge offline or
  no master resume)" rather than erroring.
- Answers-only response with an ungrounded skill claim → does NOT block
  submission (unlike the risky-bullet checkbox gate for full resume regen);
  it only appends a warning string to `rewritingReport.warnings`. If the user
  wants this to be a hard gate (matching the bullet flow's "I reviewed and
  accept" checkbox), that's a follow-up — not currently enforced.
- MutationObserver fires on ANY added form control anywhere in `document.body`,
  not scoped to the detected form container specifically (the plan proposed
  scoping to the form container, but `document.body` was used for simplicity
  since job-board pages typically have one relevant form). If a page has
  unrelated forms elsewhere (ads, cookie banners) causing noisy re-extracts,
  consider scoping to `detectedElements.formContainer` from `DetectionResult`.

## Warnings

- `lib/shared/constants.ts` `BOARD_COVERAGE` entries for the 3 new boards say
  `lastVerified: "unverified"` — do not present these to the user as "tested
  and working" without actually checking a live page first.
- The `answerWarnings` push in `packages/skill/src/manual/process.ts` uses
  `extractTechKeywords` for detection, which is a simple keyword list — it
  will not catch non-tech hallucinated claims (fake employers, fake metrics,
  fake soft-skill claims) in answers-only mode. Full bullet rewrites get
  stronger invariant checks (`validators/invariant-checks.ts`); answers-only
  mode has weaker grounding coverage by design/scope, not oversight — flagged
  here so it isn't mistaken for equivalent protection.
