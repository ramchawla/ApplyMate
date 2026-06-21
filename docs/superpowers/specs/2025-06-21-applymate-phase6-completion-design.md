# ApplyMate Phase 6: Completion (Working PDF + Board Extractors) — Design

**Document**: Design Spec
**Version**: 1.0
**Date**: 2025-06-21
**Status**: Ready for Implementation Planning

---

## Goal

Make ApplyMate genuinely work for daily personal use by closing the two gaps that block the real workflow:

1. **PDF compile actually produces a PDF** — replace the dead-CDN SwiftLaTeX WASM path with a reliable local Tectonic compile in the dashboard's own Node runtime.
2. **Board-specific extraction** — accurate JD/title/company extraction on the boards actually used (LinkedIn, Greenhouse, Lever, Ashby, Workday), with the existing generic extractor as fallback.

Offline operation is explicitly **not** a goal. Reliability on the user's own machine is.

---

## Section 1: PDF Compile via Local Tectonic

### Decision

The dashboard is a local Next.js Node server, so it compiles LaTeX directly through a route handler — no bridge round-trip, no token/CORS concerns (same origin). The SwiftLaTeX WASM path is removed.

### Components

**`lib/local/compile-latex.ts`**
```typescript
export async function compileLatex(latex: string): Promise<Buffer>
export class TectonicMissingError extends Error {}
```
- Writes `latex` to a unique temp file under the OS temp dir (`mkdtemp`).
- Runs `tectonic <file.tex>` via `child_process.execFile` with the temp dir as cwd.
- Reads the produced `<file>.pdf`, returns its bytes as a `Buffer`.
- Cleans up the temp dir in a `finally`.
- If `tectonic` is not on PATH (ENOENT), throws `TectonicMissingError` with the message: `"tectonic not found. Install it: brew install tectonic"`.
- On non-zero exit, throws an `Error` whose message includes the last ~2000 chars of tectonic stderr/stdout.

**`packages/dashboard/app/api/compile/route.ts`** (Node runtime)
- `export const runtime = "nodejs"`.
- `POST` with JSON body `{ latex: string }`.
- Validates `latex` is a non-empty string → 400 otherwise.
- Calls `compileLatex`; returns the PDF with `Content-Type: application/pdf` on success.
- `TectonicMissingError` → 503 with `{ error, hint }`.
- Other errors → 500 with `{ error }` (the tectonic log tail).

**`packages/dashboard/components/PdfCompiler.tsx`** (client)
- `POST`s `{ latex }` to same-origin `/api/compile`.
- On 200: reads the blob, shows it in an `<iframe>` + a download link.
- On non-200: shows the JSON `error` (+ `hint` if present) and keeps the Raw LaTeX download available.

### Removals
- Delete `lib/local/latex-wasm.ts`.
- Delete `packages/dashboard/public/swiftlatex/` (all vendored assets).
- Remove the SwiftLaTeX references from README's resume-alignment note; replace with the local-Tectonic description.

### Testing
- `tests/dashboard/compile-latex.test.ts`:
  - **Always runs:** calling `compileLatex` when `tectonic` is absent (simulated by setting `PATH=""` for the call, or by asserting on a guaranteed-missing binary name via an injected binary param) throws `TectonicMissingError`. To keep this deterministic, `compileLatex` accepts an optional `binary` param (default `"tectonic"`); the test passes a guaranteed-missing name and asserts `TectonicMissingError`.
  - **Conditional:** if `tectonic` is on PATH, compiling a minimal valid document returns bytes starting with `%PDF`. Skipped via `it.skipIf(!hasTectonic)` when absent.
- Manual gate: with `tectonic` installed, compile a real resume version from the dashboard and confirm the PDF renders.

### Prerequisite
- `brew install tectonic` (documented in README + the plan's prereqs).

### Resume impact
- Retire "client-side LaTeX→PDF via Tectonic-WASM."
- New: "Compiled résumé LaTeX→PDF through a local Tectonic compile service exposed by the Next.js dashboard." (The flashier client-side bullet can return in the enhancements cycle if desired.)

---

## Section 2: Board-Specific Extractors

### Decision

One extractor module per board, dispatched by the detected board. The generic extractor remains the always-on fallback so unknown sites never regress.

### Detection

- Extend `BOARD_DETECTION_PATTERNS` (in `lib/shared/constants.ts`) with **Workday**:
  ```typescript
  workday: {
    urlPattern: /myworkdayjobs\.com/,
    domSelectors: ["data-automation-id"],
    confidence: 0.95,
  }
  ```
- Add per-board detector modules and include **all five** in the `detect()` chain in `packages/extension/src/content/detectors/index.ts`:
  `detectLinkedIn → detectIndeed → detectGreenhouse → detectLever → detectAshby → detectWorkday → detectGeneric`.
  Greenhouse/Lever/Ashby patterns already exist in constants; add detector modules that mirror the existing LinkedIn/Indeed shape (URL pattern → 0.95–0.99; DOM-substring fallback → 0.8; else unknown).

### Extraction

**`packages/extension/src/content/extractors/boards/{linkedin,greenhouse,lever,ashby,workday}.ts`**

Each exports:
```typescript
export function extract(doc: Document): ExtractedContent
```
returning `{ jobDescription, jobTitle, company }`, using board-specific selectors:

- **LinkedIn**: title `.job-details-jobs-unified-top-card__job-title, .topcard__title`; company `.job-details-jobs-unified-top-card__company-name, .topcard__org-name-link`; JD `.jobs-description__content, .description__text`.
- **Greenhouse**: title `.app-title, h1.section-header, h1`; company `.company-name, meta[property='og:site_name']`; JD `#content, .job__description, #job_description`.
- **Lever**: title `.posting-headline h2, h2`; company from `meta[property='og:site_name']` or `.main-header-logo img[alt]`; JD `.section-wrapper.page-full-width, .section[data-qa='job-description'], .content`.
- **Ashby**: hashed class names → anchor on structure: title `h1`; company `meta[property='og:site_name']` or document title prefix; JD the largest `[class*='descriptionText'], main` text block.
- **Workday**: title `[data-automation-id='jobPostingHeader']`; JD `[data-automation-id='jobPostingDescription']`; company from `meta[property='og:site_name']` or the page title; (Workday's `data-automation-id` attributes are the stable anchor).

**Dispatch** — `extractJD(html, board)` in `extractors/index.ts`:
- Parse HTML to a `Document` once.
- `switch (board)` → call the matching board `extract(doc)`.
- If the board module returns empty strings or throws, fall back to the generic `extractJDContent`.
- Unknown/generic board → generic extractor directly.

**Helper** — each board extractor uses a shared `textOf(doc, selectors: string[]): string` util that returns the trimmed `textContent` of the first matching selector, or `""`. Lives in `extractors/boards/util.ts`.

### Form fields
- Unchanged: the generic label-driven `extractFormFields` works across boards.
- Workday SPA forms: best-effort with the existing manual-validation gate; not over-engineered this cycle.

### Testing
- `tests/extension/board-extractors.test.ts`:
  - One representative fixture HTML snippet per board (small, containing that board's known selectors) → assert title/company/JD extracted correctly.
  - Dispatch test: `extractJD(html, "workday")` uses the Workday extractor (asserts a Workday-only selector value surfaces).
  - Fallback test: a board extractor given HTML with none of its selectors returns the generic result (non-empty JD from a generic blob).
- `tests/extension/detectors.test.ts`: add cases for Greenhouse, Lever, Ashby, Workday URL detection.

### Boundaries
- Each board file is independent and individually testable.
- Generic fallback guarantees no regression on unknown or restructured pages.

---

## Out of Scope (this cycle)

- Auto-uploading the generated PDF into the form (deferred; needs the compile service first — candidate for a follow-up).
- Dashboard status-mutation UI.
- One-command dev + CI + real icon + Playwright extension E2E.
- All enhancement-cycle items (hybrid retrieval, ATS scoring, eval harness, feedback loop, etc.).

---

## Success Criteria

- [ ] `tectonic` installed → dashboard "Compile PDF" produces a rendering PDF from a real resume version.
- [ ] `compileLatex` throws a clear, actionable error when `tectonic` is missing.
- [ ] SwiftLaTeX WASM code + assets fully removed; no dead references.
- [ ] All five boards detected by URL; each has a working extractor verified against a fixture.
- [ ] Generic fallback still passes existing extraction tests.
- [ ] Full suite green; type-checks clean.

---

## Self-Review

- **Placeholders:** none — exact files, selectors, signatures, and test strategy specified.
- **Consistency:** reuses `ExtractedContent`, `detect()` chain shape, `BOARD_DETECTION_PATTERNS`, existing generic extractor. PDF path replaces (not duplicates) the WASM path.
- **Scope:** focused — two sections, both usage-critical; everything else explicitly deferred.
- **Ambiguity:** PDF compile is dashboard-only (not bridge); board extraction always has a generic fallback; test determinism handled via injectable `binary` param + `skipIf`.
