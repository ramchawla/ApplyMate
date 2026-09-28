# ApplyMate Sub-project 2: Multi-step ATS Coverage — Design

**Date**: 2026-09-28
**Status**: Approved in chat ("Approve, build it"); written spec
**Branch**: `multistep-ats`
**Builds on**: `docs/superpowers/specs/2026-09-28-one-click-core-design.md` (merged)

## Goal

Extend one-click to multi-step application wizards — Workday, LinkedIn Easy
Apply, and similar (SuccessFactors, Taleo, iCIMS) — so one ⚡ press fills each
step and **auto-advances to the final review page**, where it stops for the
user to press Submit. Also reach forms inside open shadow roots
(SmartRecruiters, custom career sites).

### Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Wizard behaviour | **Auto-advance to review**: fill a step, press Next/Continue/Save and Continue/Review, repeat; stop at the page whose primary button is Submit. Pause early on empty required fields or validation errors. |
| Order | #2 before #3. |
| Sign-in | Never automated. The user signs in (Workday tenant, LinkedIn); no account creation, no password handling. |
| Consent/terms checkboxes | Never auto-checked unless a profile `answers` rule matches; otherwise they are required-empty, so the wizard pauses and highlights them. |

### Out of scope

Match-score badges, pre-tailor queue, dashboard/tracker UI, profile editor UI
(sub-project 3); sign-in/account automation; CAPTCHA handling; closed shadow
roots.

## 1. Wizard engine (generic)

`runOneClick` becomes a step loop (single-page forms are a one-step wizard):

1. Scan the current step (`extractLiveFields`, stamping on).
2. Instant-fill from profile + answer rules (unchanged).
3. Tailoring (`TAILOR_START`) starts **once**, on step 1, with step 1's pending
   questions. It keeps polling in the background across steps.
4. If the step has a resume file input: wait for the tailored PDF (status
   "Waiting for tailored resume… Ns"), then attach. If tailoring failed, stop.
5. Pending questions on steps ≥2 that tailoring didn't answer → `ANSWER_START`
   (answers-only Claude call, §2) → poll → fill. User-touched fields are never
   overwritten (unchanged rule).
6. `highlightEmptyRequired` → any → **pause**: "N required fields need you".
7. `findStepButton(doc)`:
   - **submit** (text `/^(submit( my)?( application)?|send application|apply|finish)$/i`,
     aria-label `/submit application/i`) → **stop**: "Ready for review — check
     everything, then click Submit".
   - **advance** (text `/^(next|continue|save (and|&) continue|review( your application)?|proceed)$/i`,
     aria-label `/continue to next step|review your application/i`,
     `data-automation-id` `/pageFooterNextButton|bottom-navigation-next-button/`)
     → press it.
   - none → stop.
   Search inside the topmost open `[role=dialog]` first (LinkedIn modal), else
   the document; only visible, enabled controls.
8. `waitForStepChange` (MutationObserver, quiet-period debounce, 12s cap): the
   step signature (sorted visible field labels + first heading) must change.
   No change → collect visible errors (`[role=alert]`, `[aria-invalid=true]`
   labels, `.error` text) → **pause** with them.
9. Repeat; hard cap 15 steps.

The widget shows per-step progress ("Step 3 · 9 fields filled"). Stop/pause
states re-enable the ⚡ button so the user can fix and press again (which
resumes from the current step, reusing the finished tailoring job for the
same job key).

## 2. Answers-only bridge call

- `POST /answer {job, fields}` → `{ jobId }`; `GET /answer/:id` → `{ status,
  error?, answers? }`. Separate FIFO queue from `/tailor` (they may run
  concurrently).
- `answerQuestions(req, files, deps)` in `packages/skill/src/tailor/answer.ts`:
  prompt = job + questions + corpus + profile (no resume parts, no compile);
  schema `{ answers: [{ fieldId, value }] }`; same FORM ANSWERS rules and
  untrusted-data line as tailoring; answers filtered to asked fieldIds.
- Background messages `ANSWER_START` / `ANSWER_POLL`.

## 3. Profile lists

`profile.yaml` gains (all optional, normalized like the rest):

```yaml
work:        # most recent first
  - { company: RBC, title: Senior Software Engineer, location: "Toronto, ON",
      start: 2026-05, end: "", current: true, description: "…" }
education:
  - { school: University of Toronto, degree: "Bachelor of Science", major: Computer Science,
      gpa: "", start: 2020, end: 2024 }
skills: [TypeScript, Kubernetes, …]
languages: [English]
```

- `current.company/title` and single `education` getters fall back to
  `work[0]` / `education[0]` when the scalar fields are empty.
- `pnpm profile:sync` fills **only empty** lists by asking `claude -p` (same
  isolation flags) to extract work/education/skills from
  `resume-master.tex` + `experience.yaml` into that schema (plain text, dates
  `YYYY-MM`/`YYYY`). Never overwrites user edits.

## 4. Widget/field coverage additions (generic)

- **Dropdown buttons** `button[aria-haspopup=listbox]` → field type
  `combobox` (label via `label[for]`/`aria-labelledby`/question text). Fill:
  press → wait for scoped options → press best match (existing matcher).
- **Search prompts** (Workday `input[data-automation-id=searchBox]` inside a
  prompt container) → combobox fill with typing + Enter; options
  `[data-automation-id=promptOption]`; if the best match is a category
  (opens a sub-list), press it and match again (one level).
- **Shadow DOM**: extraction, label lookup, `findField`, option lookup and
  step-button search traverse open shadow roots (`getRootNode()` for
  `label[for]` lookups).
- **LinkedIn Easy Apply**: the modal (`[role=dialog]` containing
  `.jobs-easy-apply-*` or aria-label/heading "Apply to …") counts as an
  application form for the gate; resume = its file input ("Upload resume");
  follow-company checkbox untouched.

## 5. Workday adapter

Active when the host matches `myworkdayjobs.com|myworkdaysite.com|workday.com`
or `[data-automation-id]` form markup is present.

- **Repeating sections** (Work Experience, Education, Websites): find the
  section by heading, count existing entry groups, press its **Add** button
  until entries = list length (cap 5), then fill each entry's fields by label
  within the entry container: Job Title, Company, Location, I currently work
  here, From/To (month/year), Role Description; School or University, Degree,
  Field of Study, Overall Result (GPA), From/To (year); URL.
- **Date spinners** (`dateSectionMonth/Day/Year-input`, role spinbutton):
  typed digits via `typeInto`.
- **Self Identify** page: name = profile full name, date = today.
- Resume: `file-upload-input-ref` input (generic file attach).

## 6. Verification

- Unit tests per piece (jsdom) — each written first.
- Local fixtures: `tests/fixtures/pages/workday/*.html` (multi-page wizard
  with dropdown buttons, prompts, Add sections, date spinners, Save and
  Continue → Review → Submit) and `tests/fixtures/pages/linkedin-easy-apply.html`
  (modal, Next/Review/Submit application, typeahead, resume upload). Run the
  shipped engine against them in the Playwright window (visible) via the
  esbuild harness; also in the extension via Claude in Chrome where hidden-tab
  limits allow.
- Live: the user signs into one Workday tenant and LinkedIn in the visible
  Playwright window; run the wizard engine (harness) on a real application
  **without ever pressing Submit** (bridge off → no uploads), and confirm it
  stops at Review. Regression-check Greenhouse/Lever/Ashby.

## Success criteria

On a real Workday application (signed in) and a real LinkedIn Easy Apply
modal: one ⚡ fills every step's profile-mappable fields, adds work/education
entries, attaches the tailored PDF on the resume step, answers custom
questions, advances automatically, and stops on the review page without
submitting. Greenhouse/Lever/Ashby keep zero misses.
