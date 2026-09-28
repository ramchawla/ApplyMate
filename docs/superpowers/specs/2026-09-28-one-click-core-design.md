# ApplyMate Sub-project 1: One-Click Core — Design

**Date**: 2026-09-28
**Status**: Approved in brainstorming; awaiting written-spec review
**Branch**: `one-click-core`

---

## Goal

Replicate the core of Simplify Copilot's paid tier, locally and at zero API
cost: **one click** on a job application page fills every standard field,
tailors the resume to the job (JD keywords and/or user-typed keywords),
auto-attaches the tailored PDF, drafts custom-question answers, and logs the
application. The user reviews and clicks the site's Submit. ApplyMate never
submits.

### Why the current build fails this goal

| Problem | Evidence |
|---|---|
| Tailoring needs ~8 manual steps (copy prompt → claude.ai → paste corpus → save JSON → terminal CLI → poll) | `TailoringReview.tsx` |
| Only one bullet block is tailorable (single `%%BULLETS%%` marker; summary, skills, other roles static) | `~/.applymate/resume-template.tex:149` |
| Resume PDF is never attached | `fill.ts:17` (`isFile` skipped) |
| 4-screen wizard before anything fills | `side-panel.tsx` |
| Content script only on 6 domains; iCIMS/Workable/SmartRecruiters/JSON-LD fallback unreachable | `manifest.json` |
| Fields without `id`/`name` get `field-N` ids that `findField` can never resolve | `form.ts:31`, `fill.ts:51` |
| No user keyword input | — |
| Bridge token regenerates every start → re-paste every time | `bridge/src/start.ts:14` |

### Decisions made in brainstorming

| Decision | Choice |
|---|---|
| Keyword honesty | **Judgment-led**: Claude decides applicability and may reframe adjacent real work; never invents metrics/employers/titles/dates. Code checks **warn only** (except broken LaTeX). |
| Click flow | **Fill now, tailor behind**: instant profile fill, tailored PDF + answers land ~30-60s later. |
| Engine | **Bridge spawns `claude -p`** (headless Claude Code on the user's subscription; verified working, no `ANTHROPIC_API_KEY` set). |
| Scope | Sub-project 1 of 3. #2 = multi-step ATS (Workday, LinkedIn Easy Apply, iCIMS/SmartRecruiters/Taleo, widget library). #3 = AIApply side (match score, pre-tailor queue, dashboard tracker, profile/answers editor UI). |
| Submit | Never automatic. |
| Master resume | `~/.applymate/resume-master.tex` (single source of truth). |

### Out of scope (this sub-project)

Workday and LinkedIn Easy Apply multi-step automation, match-score badges on
postings, queue mode, dashboard changes beyond status updates, profile editor
UI, parallel tailoring jobs, a bridge-offline master-PDF cache.

---

## Section 1 — User experience

### In-page widget

A shadow-DOM card (bottom-right, collapsible) rendered by the content script in
the **top frame only**. Shown only when the page has a JD **or** an application
form (≥3 fillable controls, or a file input whose label matches resume/CV).

```
┌─ ApplyMate ─────────────────────┐
│ Senior SWE · Acme   JD: ✓ page  │
│ Keywords: [kubernetes ×][go ×] +│
│ [ ⚡ Autofill & Tailor ]         │
│ ✓ 14 fields filled              │
│ ⏳ Tailoring resume… 0:32        │
│ ✓ PDF attached · 3 answers ✎    │
│ ⚠ 2 required fields need you    │
│ Keywords: ✓k8s ✓go ✗rust(no exp)│
└─────────────────────────────────┘
```

- **Keywords**: chip input, persisted in `chrome.storage.local` (sticky across
  jobs until the user removes them).
- **JD indicator**: `page` / `cached` / `recent (dismiss)` / `none`.
- On a posting page with no form, the widget shows the job and `JD captured ✓`
  (no fill button).

### One click

1. **Instant (<1s)** — fill every field whose type the heuristics map, from the
   cached profile and the profile's `answers` rules. Required fields left empty
   get a yellow outline.
2. **Background (~30-60s)** — `POST /tailor` to the bridge; poll. On result:
   1. Attach the tailored PDF to the resume file input
      (`Ram_Chawla_<Company>_<Role>.pdf`).
   2. Cover letter → cover-letter textarea, or the cover-letter PDF → a
      cover-letter file input.
   3. Fill Claude's answers into the remaining fields.
   4. Wait ~1.5s, re-apply phase-1 values (Lever/Ashby resume parsers overwrite
      fields on upload).
3. **User** reviews and clicks the site's Submit. The content script sees the
   submit (form `submit` event, or click on a button whose text matches
   `/submit( application)?|apply/i` inside the application form) and calls
   `POST /applications/applied`.

### JD sourcing (first hit wins)

1. JD extracted from the current page (existing board extractors + JSON-LD).
2. JD cache keyed by normalized job URL (strip query/hash and trailing
   `/apply`, `/application`) — filled whenever a posting page is seen.
3. Most recent JD seen in the last 30 minutes (widget shows its title/company
   with a dismiss ×).
4. None → tailoring runs on user keywords alone.
5. Side panel "Paste JD" box overrides all of the above for the current tab.

### Profile — `~/.applymate/profile.yaml`

One file, created by `pnpm profile:init` pre-filled from `experience.yaml`
`profile:` and the master resume header. Served by the bridge (`GET /profile`),
cached by the extension in `chrome.storage.local` so instant fill works while
the bridge is busy or offline.

```yaml
name: { first: Ram, last: Chawla, preferred: Ram }
email: chawlaram1@gmail.com
phone: ""
address: { street: "", city: "", state: "", zip: "", country: "" }
location: ""            # "City, ST" free text
links: { linkedin: ..., github: ..., portfolio: ... }
current: { company: RBC, title: Senior Software Engineer }
education: { school: "", degree: "", major: "", gpa: "", start: "", end: "" }
work_auth: { authorized: "", sponsorship: "" }
start_date: ""
salary: ""
relocate: ""
eeo: { pronouns: "", gender: "Decline to self-identify", race: "Decline to self-identify",
       hispanic: "Decline to self-identify", veteran: "Decline to self-identify",
       disability: "Decline to self-identify" }
answers:                # first matching rule wins; match = case-insensitive regex on question label
  - { match: "how did you hear", answer: "LinkedIn" }
  - { match: "sponsor", answer: "No" }
```

### Side panel (slimmed)

Three things: one-time bridge pairing (token field + status), details of the
last run for this tab (bullet diff, keyword report, warnings, cover letter
text, link to PDF), and a Paste-JD box. The 4-step wizard, copy-prompt flow,
`FormValidation`, `TailoringReview`, `FormAutoFill`, `JobDataReview`,
`KeywordGap`, and `manual-prompt.ts` are deleted.

---

## Section 2 — Tailoring engine (bridge)

### API (all token-protected except `/health`)

| Route | Purpose |
|---|---|
| `POST /tailor` | Body `TailorRequest`; returns `{ jobId }` immediately. |
| `GET /tailor/:id` | `{ status: "queued"\|"running"\|"done"\|"error", result?, error? }` |
| `GET /tailor/:id/resume.pdf`, `/cover-letter.pdf` | PDF bytes (for "open PDF" and attach). |
| `GET /profile` | Parsed `profile.yaml`. |
| `POST /applications/applied` | `{ jobUrl }` → status `applied`. |

The extension polls every 2s from the service worker. Async, because an MV3
service worker can be killed during a single 60s fetch. Jobs run **one at a
time** through an in-memory FIFO queue. (ponytail: global queue; parallel
workers if throughput matters.)

```ts
interface TailorRequest {
  job: { title: string; company: string; url: string; description: string }; // description may be ""
  keywords: string[];
  fields: { fieldId: string; label: string; type: string; options?: string[]; required: boolean }[];
  wantCoverLetterPdf: boolean;
}
interface TailorResult {
  applicationId: string;
  resumePdfUrl: string; fileName: string;
  coverLetter: string; coverLetterPdfUrl?: string;
  answers: { fieldId: string; value: string }[];
  keywords: { injected: { keyword: string; where: string }[]; skipped: { keyword: string; reason: string }[] };
  edits: { id: string; before: string; after: string; reverted?: string }[];
  warnings: string[];
  pages: number;
}
```

### Pipeline

1. **Parse** `resume-master.tex` into addressable parts (`resume-doc.ts`):
   - Every `\resumeItem{…}` inside `\resumeItemListStart…\resumeItemListEnd`
     in Experience and Projects → id `r<role>.b<bullet>` (brace-matched).
   - `summary` = the argument of `\small{…}` under `\section{Summary}`.
   - `skills.<label>` = each `\textbf{<Label>}{: …}` line under
     `\section{Technical Skills}`.
   - Everything else (preamble, header/contact, headings, companies, titles,
     dates, education) is **not exposed** → structurally unchangeable.
   - Invariant: `render(parse(tex), noEdits) === tex`.
2. **Prompt + call** (`claude-cli.ts`):
   `claude -p --model ${APPLYMATE_MODEL:-sonnet} --output-format json --json-schema <schema> --tools "" --no-session-persistence --system-prompt <rules>`,
   cwd `~/.applymate`, prompt on stdin, 180s timeout. Prompt contains:
   `generation-directives.md`, `experience.yaml`, resume parts with ids (grouped
   by role heading), JD, user keywords (marked priority), fields to answer
   (with options), `profile.yaml`.
   Rules (judgment-led): inject keywords where they honestly apply, may reframe
   adjacent real work; never invent metrics, employers, titles, dates; keep each
   bullet within ~10% of original length; keep LaTeX valid (`\textbf{}`,
   escape `% & $ # _`); reorder bullets within a role (most relevant first);
   reorder skills lists (front-load JD terms, never add unlisted skills);
   select answers must be one of the given options verbatim.
   Output schema:
   ```ts
   { edits: { id: string; latex: string }[];
     order: { role: string; ids: string[] }[];
     keywords: { injected: { keyword: string; where: string }[]; skipped: { keyword: string; reason: string }[] };
     coverLetter: string;
     answers: { fieldId: string; value: string }[] }
   ```
   The claude runner is an injected function so tests use a fake.
3. **Checks** (`checks.ts`, reuse `extractMetrics` from
   `validators/invariant-checks.ts`) — all **warn only**, except the LaTeX one:
   - New number in an edit not present in its original → "possible invented metric".
   - Metric in original missing from the edit → "dropped metric".
   - Seniority inflation (reuse existing detector).
   - Injected keyword not found in `experience.yaml` or master resume text →
     "reframed — verify you can speak to it".
   - Unknown edit id / order that isn't a permutation of that role's ids →
     ignored with a warning.
   - **Hard**: unbalanced braces or unescaped `% & $ # _` → that edit reverted.
4. **Compile** via existing `lib/local/compile-latex.ts`; count pages (`/Type
   /Page` objects). While pages > 1: revert the not-yet-reverted edit with the
   largest length growth, recompile (max 10 iterations). Compile error → revert
   all edits and compile master; error recorded in `warnings`. A PDF always
   returns (unless master itself fails — then the job errors).
5. **Cover letter**: plain text from Claude. If `wantCoverLetterPdf`, render
   into a minimal letter `.tex` (escaped) and compile.
6. **Persist**: existing `persistOutput` (SQLite, status `drafted`) plus
   `~/.applymate/applications/<YYYY-MM-DD>-<company>-<role>/` with
   `resume.tex`, `resume.pdf`, `cover-letter.md`, `report.json`, `jd.md`.

### Bridge operations

- Token persisted: reuse `~/.applymate/bridge-token` if present, else generate
  once. User pastes it into the side panel once, ever.
- `pnpm bridge:install` writes `~/Library/LaunchAgents/com.applymate.bridge.plist`
  (RunAtLoad, KeepAlive, logs to `~/.applymate/bridge.log`) and loads it.
- Bridge offline → widget still does instant fill and shows "bridge offline —
  start it with `pnpm bridge`".

### Cleanup after verification (with user OK)

Delete now-unused: `stages/retrieve.ts`, `db/`, `embeddings/`,
`docker-compose.yml`, `db/schema.sql`, `manual/`, `cli/manual.ts`,
`apply-to-job.md`, `assemble-latex.ts` marker path, `resume-template.tex`
dependency, and their tests.

---

## Section 3 — Extraction, fill mechanics, testing

### Extraction (live DOM)

- Extract from the live `document`, not a `DOMParser` re-parse; stamp each
  control with `data-applymate-id` (stable per page load). Fill resolves by that
  attribute first, then id/name.
- Label resolution order: `label[for]` → wrapping `<label>` → `aria-labelledby`
  → `aria-label` → `fieldset > legend` (radio/checkbox groups) → nearest
  preceding question text in the field's container.
- A radio group is one field (options = radio labels).
- ARIA comboboxes (`role="combobox"`) and Yes/No button groups are extracted as
  `select`-like fields with their visible options when discoverable.
- Value types expanded: `first-name, last-name, name, preferred-name, email,
  phone, address, city, state, zip, country, location, linkedin, github,
  website, current-company, current-title, school, degree, major, gpa,
  grad-date, work-auth, sponsorship, start-date, salary, relocate, how-heard,
  pronouns, gender, race, hispanic, veteran, disability, resume, cover-letter,
  custom-q`.
- Rule answers from `profile.answers` are checked before type heuristics.

### Fill

- Native text/select/radio/checkbox: existing React-safe setters.
- File: `DataTransfer` with a `File` built from the PDF bytes; dispatch
  `input` + `change`.
- ARIA combobox: focus/click → type value → wait (≤1.5s) for `[role=option]`
  → click best match (exact → startsWith → includes).
- Button groups: click the button whose text equals the value.
- iframes: manifest `all_frames: true`; fill commands broadcast to every frame
  in the tab; each frame fills the fields it owns.
- Manifest: content script on `<all_urls>`; widget gating as in Section 1.

### Testing

- **Unit (vitest/jsdom)**: resume-doc parse/render round-trip on the real
  master resume shape and edits/reorder splice; each check; Claude output
  parsing; page-fit loop with fake compiler; label + type inference on
  Greenhouse/Lever/Ashby-shaped HTML; combobox/button-group/file fill; profile
  rules matching; JD cache keying.
- **Bridge**: `/tailor` lifecycle with a fake runner; token + host checks keep
  passing.
- **Real E2E (local)**: one real `claude -p` run + tectonic compile of the real
  master resume → 1-page PDF.
- **Live (Claude in Chrome)**: real Greenhouse, Lever, Ashby postings plus one
  company site embedding Greenhouse in an iframe. Load unpacked extension,
  click ⚡, confirm: fields filled, PDF attached (ATS shows filename), answers
  present, report visible. **Never click Submit.** Record a GIF.

### Success criteria

On a live Greenhouse/Lever/Ashby application: one click → standard fields
filled in <1s; within ~90s tailored 1-page PDF attached, custom questions
answered, keyword report shown; application appears in the dashboard as
`drafted`, and as `applied` after the user submits. With no JD available, the
keyword box alone drives tailoring.
