# Multi-step ATS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One ⚡ press fills each step of Workday / LinkedIn Easy Apply / similar wizards, auto-advances, and stops on the review page without submitting.

**Architecture:** Generic pieces first — shadow-DOM-aware queries, dropdown-button and search-prompt widgets, step-button detection and step-change waiting — then a step loop replacing `runPhases`, an answers-only bridge call for later steps, profile work/education lists, and a thin Workday adapter for repeating sections and date spinners. LinkedIn Easy Apply needs only dialog scoping on top of the generic engine.

**Tech Stack:** TypeScript strict, vitest + jsdom, Chrome MV3 content script (IIFE), Node bridge, `claude -p`, Playwright harness for live checks.

**Spec:** `docs/superpowers/specs/2026-09-28-multistep-ats-design.md`

## Global Constraints

- Never press a submit/apply control. Auto-advance presses only advance controls; stop when a submit control is present.
- Never automate sign-in or account creation; never auto-check consent/terms checkboxes (unless a profile `answers` rule matches the label).
- User-touched fields are never overwritten (existing rule) — applies on every step.
- All new DOM reads/writes must work inside open shadow roots.
- Every page-derived string rendered in the widget stays escaped; Claude answers stay limited to asked fieldIds.
- Wizard cap: 15 steps; step-change wait cap: 12s; answer call timeout: 180s (claude runner default).
- Content script stays a classic IIFE; TS strict; each behavior change lands with a test that failed first.

## Review Focus

- A wizard whose Next leaves the step unchanged because of validation errors must pause with the errors, not loop.
- Pages with both "Back" and "Submit application" (LinkedIn review) must stop, never press Back.
- Page-level search/comboboxes outside an open application dialog (LinkedIn global search) must not be filled.
- Re-running ⚡ after a pause must resume without duplicating Workday "Add" entries or overwriting edits.
- Anonymous field ids must stay unique across repeated and scoped scans (Workday entries added later).

---

### Task 1: shadow-DOM-aware queries and scoped, unique extraction

**Files:** Modify `packages/extension/src/content/dom.ts`, `packages/extension/src/content/extractors/form.ts`, `packages/extension/src/content/fill.ts`; Test `tests/extension/shadow.test.ts`, update `tests/extension/fill.test.ts` (radiogroup test uses the returned id).

**Produces:** `deepQueryAll<T extends Element>(root: ParentNode, selector: string): T[]`; `extractLiveFields(root: Document | Element, opts?)` (root may be a subtree; anonymous ids `am-<n>` from a module-wide counter, never reused on a page); `findField` searches shadow roots; label lookups use `el.getRootNode()`.

- [ ] Tests (fail first):
  - fields inside an open shadow root are extracted, labelled via the shadow root's `label[for]`, and filled by `applyFill`;
  - `extractLiveFields(container)` only returns that container's fields;
  - two scans of different subtrees never produce the same anonymous id.
- [ ] Implement `deepQueryAll` (querySelectorAll + recurse into every `el.shadowRoot`), switch extraction/findField/option queries to it, `rootOf(el) = el.getRootNode()` for `label[for]`/`getElementById`, module counter for `am-` ids.
- [ ] `pnpm test:extension` green; commit `feat: shadow-DOM-aware extraction and fill; scoped scans`.

### Task 2: dropdown buttons and search prompts

**Files:** Modify `form.ts`, `fill.ts`; Test `tests/extension/widgets.test.ts`.

**Produces:** extraction of `button[aria-haspopup=listbox]` / `[role=button][aria-haspopup=listbox]` as `type: "combobox"` fields (label via `label[for]`, else `aria-labelledby` minus the button's own text, else question text; placeholder texts like "Select One" stripped); `fillElement` handles (a) dropdown buttons: press → wait for scoped option → press; (b) prompt inputs (`input[data-automation-id=searchBox]` or inside `[data-automation-id*=multiselect i]`): type head + Enter → wait for `[data-automation-id=promptOption]` match → press. `OPTION_SELECTOR` gains `[data-automation-id=promptOption], [data-automation-id=menuItem]`.

- [ ] Tests (fail first): Workday-style dropdown button with a listbox rendered on press → correct option pressed; prompt input that renders options on Enter → leaf pressed; placeholder "Select One" stripped from label; scoping keeps another open listbox's options out.
- [ ] Implement; green; commit `feat: dropdown-button and search-prompt widgets`.

### Task 3: step detection

**Files:** Create `packages/extension/src/content/wizard.ts`; Test `tests/extension/wizard.test.ts`.

**Produces:**
```ts
type StepButton = { el: HTMLElement; kind: "advance" | "submit" };
function activeScope(doc: Document): ParentNode            // topmost visible [role=dialog]/dialog[open] with form controls, else doc
function findStepButton(doc: Document): StepButton | null  // submit wins over advance
function stepSignature(doc: Document): string             // visible field labels + first heading in scope
function waitForStepChange(doc: Document, before: string, ms?: number): Promise<boolean>
function visibleErrors(doc: Document): string[]           // [role=alert], [aria-invalid=true] labels, error-message classes/automation ids; max 5
```
- [ ] Tests (fail first): Next-only page → advance; page with Back + Submit application → submit (Back never chosen); Workday `pageFooterNextButton` "Save and Continue" → advance; dialog scope beats page buttons; disabled/hidden buttons ignored; step change resolves true when fields swap and false on timeout; errors collected.
- [ ] Implement; green; commit `feat: wizard step detection`.

### Task 4: answers-only call

**Files:** Create `packages/skill/src/tailor/answer.ts`; Modify `packages/bridge/src/server.ts`, `packages/bridge/src/tailor-job.ts`, `packages/bridge/src/start.ts`, `packages/extension/src/background.ts`; Tests `tests/skill/answer.test.ts`, `tests/bridge/answer-routes.test.ts`.

**Produces:** `answerQuestions(req: { job; fields }, files: { corpusYaml; profileYaml }, deps: { runClaude; claudeCwd? }): Promise<{ answers }>` (schema `{ answers: [{fieldId, value}] }`, system = FORM ANSWERS rules + untrusted-data line, answers filtered to asked ids); bridge `POST /answer` → 202 `{jobId}`, `GET /answer/:id` → `{status, error?, answers?}` on its own queue; `makeAnswerJob({dir, runner?})`; background `ANSWER_START {request}` / `ANSWER_POLL {jobId}`.

- [ ] Tests (fail first): prompt contains questions/options/corpus/profile and no resume parts; unasked answers dropped; routes require token, validate, queue, report.
- [ ] Implement; green (`test:skill`, `test:bridge`); commit `feat: answers-only claude call for wizard steps`.

### Task 5: wizard loop

**Files:** Modify `packages/extension/src/content/content.ts`; Test `tests/extension/wizard-run.test.ts`.

**Produces:** `runOneClick` loops steps (≤15). Per step: scan `activeScope`; instant fill (untouched only); Workday sections (Task 7 hook, no-op until then); resume input present → await tailoring → attach; pending questions → from tailoring result (single-page) or `ANSWER_START/POLL` (wizard steps); required-empty → pause; `findStepButton` → submit → stop "Ready for review"; advance → press → `waitForStepChange` → unchanged → pause with `visibleErrors`. Tailoring starts once: single-page (submit visible on step 1) → combined request with questions (current behavior); wizard → request without questions. `RunReport` gains `steps: number` and `stoppedAt: "review" | "needs-you" | "errors" | "no-button" | "max-steps" | "done"`.

- [ ] Tests (fail first) on jsdom wizard fixtures:
  - 3-step wizard (profile fields → resume + question → review with Submit) ends `stoppedAt: "review"`, never presses Submit, attaches the PDF on step 2, fills the step-2 answer from `ANSWER_POLL`;
  - required empty field on step 1 → `needs-you`, Next not pressed;
  - Next that doesn't change the step and shows an alert → `errors` with the alert text;
  - single-page form behaves exactly as before (existing tests stay green);
  - user edits on step 1 survive.
- [ ] Implement; green; commit `feat: auto-advancing wizard engine`.

### Task 6: profile lists + sync

**Files:** Modify `packages/extension/src/types.ts`, `utils/profile.ts`, `lib/field-mapping.ts`, `packages/bridge/src/profile-init.ts`; Create `packages/bridge/src/profile-sync.ts`; root/bridge `package.json` script `profile:sync`; Tests extend `field-mapping.test.ts`, create `tests/bridge/profile-sync.test.ts`.

**Produces:** `Profile.work: {company,title,location,start,end,current,description}[]`, `education: {school,degree,major,gpa,start,end}[]`, `skills: string[]`, `languages: string[]` (normalized; strings; `current` "true"/""); getter fallbacks (`current-company` → `work[0].company`, `school` → `education[0].school`, …); `extractProfileLists(runner, masterTex, corpusYaml)` via claude schema; `mergeProfileLists(profileYaml, lists): string` fills only empty lists, preserving comments/other keys.

- [ ] Tests (fail first): normalize arrays; fallbacks; merge keeps existing lists and fills empty ones; fake runner output mapped.
- [ ] Implement; run `pnpm profile:sync` for real once (subscription) and inspect `~/.applymate/profile.yaml`; commit `feat: work/education lists in profile + profile:sync`.

### Task 7: Workday adapter

**Files:** Create `packages/extension/src/content/adapters/workday.ts`; hook in `content.ts` step loop; Test `tests/extension/workday.test.ts`.

**Produces:** `isWorkday(doc)`; `fillWorkdaySections(doc, profile, isTouched): Promise<{ added: number; filled: number }>` — per section (Work Experience ← `work`, Education ← `education`, Websites ← links): locate by heading, count entry groups, press Add until count = min(items, 5), fill empty fields per entry by label (dates via month/year spinbuttons with `typeInto`); `fillWorkdayDates(doc)` fills "Today"/"Date" spinner groups with today's date.

- [ ] Tests (fail first): Workday-like fixture adds 2 work entries for a 2-item profile and fills title/company/dates/description; re-running doesn't add more; filled user values untouched; date spinners receive MM and YYYY.
- [ ] Implement; green; commit `feat: Workday repeating sections and date spinners`.

### Task 8: LinkedIn Easy Apply

**Files:** Modify `content.ts` (gate + scope), Test `tests/extension/linkedin.test.ts`.

**Produces:** `isApplicationDialogOpen(doc)` (visible dialog containing form controls whose heading/aria-label matches /apply/i or class contains `jobs-easy-apply`) → gate true; scans/fills scoped to the dialog (page search box never touched).

- [ ] Tests (fail first): LinkedIn-like page with global search combobox + Easy Apply dialog → only dialog fields extracted; gate true; wizard presses "Continue to next step", then "Review your application", stops at "Submit application".
- [ ] Implement; green; commit `feat: LinkedIn Easy Apply dialog scoping`.

### Task 9: fixtures + harness verification

**Files:** Create `tests/fixtures/pages/workday/apply.html` (single-page JS wizard: My Information → My Experience with Add sections + resume drop zone → Application Questions → Voluntary Disclosures → Review with Submit), `tests/fixtures/pages/linkedin-easy-apply.html`.

- [ ] Serve fixtures; run the shipped engine (esbuild harness exposing `runOneClick` with a stub `send`) in the visible Playwright window; confirm stop at Review, all steps filled, Submit never pressed. Fix gaps test-first. Commit `test: Workday + LinkedIn wizard fixtures`.

### Task 10: live verification (user sign-in)

- [ ] Bridge off (no uploads). Ask the user to sign into one Workday tenant and LinkedIn in the visible Playwright window. Run the harness engine on a real Workday application from My Information and a real Easy Apply modal. Never press Submit. Fix gaps test-first; regression-check Greenhouse/Lever/Ashby. Commit fixes.

### Task 11: docs

- [ ] Update `CLAUDE.md` (wizard engine, `/answer`, profile lists, `profile:sync`, adapters) and `README.md` quick start. Commit.
