# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

---

## Project: ApplyMate

End-to-end AI job application automation across Chrome MV3 extension + Next.js dashboard. 5-stage LLM pipeline (JD extraction → pgvector retrieval → anchor-validated rewriting → LaTeX assembly → cover letter generation) running locally on Codex Pro (no API calls). Generates tailored resumes, auto-fills forms, tracks versions by company. **Never submits automatically.**

---

## Quick Start

### Prerequisites
- Node.js 18+
- macOS/Linux (primary dev environment)
- Codex Pro plan (local skill execution)
- Master resume stored at `~/.applymate/resume-master.tex`
- Experience corpus at `~/.applymate/experience.yaml`

### Installation
```bash
# Install dependencies
pnpm install

# Create local config
cp .env.example .env.local
# Edit .env.local with your paths

# Build extension (Vite)
pnpm build:extension

# Build dashboard (Next.js)
pnpm build:dashboard

# Start dev servers
pnpm dev:extension    # Watch + rebuild on changes
pnpm dev:dashboard    # http://localhost:3000
```

### Load Extension in Chrome
1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `packages/extension/dist`
5. Test on LinkedIn, Indeed, Greenhouse

---

## Architecture

### Directory Structure
```
ApplyMate/
├── README.md                      # Full spec (5-stage pipeline, flows, decisions)
├── packages/
│   ├── extension/                 # Chrome MV3 (TypeScript + React)
│   │   ├── src/
│   │   │   ├── content/
│   │   │   │   ├── content.ts     # Job board detection + JD extraction
│   │   │   │   ├── detectors/     # LinkedIn, Indeed, Greenhouse, Lever, Ashby
│   │   │   │   └── extractors/    # DOM parsing for JD + form fields
│   │   │   ├── ui/
│   │   │   │   ├── side-panel.tsx # Main side panel UI
│   │   │   │   ├── components/    # Form validation, autofill, manual entry, etc.
│   │   │   │   └── styles/
│   │   │   ├── lib/
│   │   │   │   ├── field-mapping.ts # Field-type → profile value mapping
│   │   │   │   ├── manual-prompt.ts # Self-contained prompt for manual LLM path
│   │   │   │   ├── bridge.ts        # Bridge server client
│   │   │   │   └── profile.ts       # Profile storage
│   │   │   ├── background.ts      # Message routing + session storage
│   │   │   ├── types.ts           # Extension-local types
│   │   │   └── utils/
│   │   │       ├── storage.ts     # chrome.storage API wrappers
│   │   │       └── messaging.ts   # Content ↔ Background ↔ Panel messaging
│   │   ├── manifest.json
│   │   └── vite.config.ts
│   │
│   ├── dashboard/                 # Next.js + SQLite + local tectonic binary
│   │   ├── app/
│   │   │   ├── applications/      # "Applications" board (list, filter, archive)
│   │   │   ├── resumes/           # "Resume Versions" (view, diff, download)
│   │   │   ├── jd-archive/        # "JD Archive" (search extracted postings)
│   │   │   └── analytics/         # Submit rate, interview rate, keyword analysis
│   │   ├── lib/
│   │   │   ├── db.ts              # SQLite connection + queries
│   │   │   ├── tectonic.ts        # Local tectonic binary wrapper (LaTeX → PDF)
│   │   │   └── diff.ts            # Resume version comparison
│   │   └── package.json
│   │
│   ├── bridge/                    # Local bridge server (port 4179, bearer token)
│   │
│   └── skill/                     # Codex skill: /apply-to-job
│       ├── apply-to-job.md        # Skill definition
│       ├── docker-compose.yml     # Optional local Postgres + pgvector
│       ├── db/schema.sql
│       └── src/
│           ├── stages/
│           │   ├── parse-jd.ts        # Stage 1: keywords, seniority, tech stack
│           │   ├── retrieve.ts        # Stage 2: pgvector or in-memory KNN
│           │   ├── rewrite.ts         # Stage 3: anchor-validated keyword injection
│           │   ├── assemble-latex.ts  # Stage 4: LaTeX assembly
│           │   └── cover-letter.ts    # Stage 5: markdown generation
│           ├── validators/
│           │   ├── invariant-checks.ts # Verify no hallucinations (core logic)
│           │   └── plausibility.ts     # Confidence scoring
│           ├── corpus/load.ts     # Load experience.yaml
│           ├── embeddings/embedder.ts # Local MiniLM embeddings (@xenova/transformers)
│           ├── db/pgvector.ts     # Optional Postgres KNN store
│           ├── manual/process.ts  # Manual-LLM path: validate pasted response
│           ├── cli/manual.ts      # pnpm skill:manual entrypoint
│           ├── types.ts           # ApplyJobInput/Output interfaces
│           └── index.ts           # Export main handler
│
├── lib/
│   ├── shared/
│   │   ├── types.ts               # Cross-package types
│   │   └── constants.ts           # Board detection patterns, field mappings
│   └── local/
│       ├── experience-store.ts    # Load + query experience.yaml
│       ├── resume-loader.ts       # Load master resume LaTeX
│       └── pgvector.ts            # Vector DB setup (if using local postgres)
│
├── tests/
│   ├── extension/                 # Content script extraction tests
│   ├── skill/                     # 5-stage pipeline tests
│   └── e2e/                       # Full flow: extract → generate → fill form
│
├── .env.example                   # Template for .env.local
├── .gitignore                     # Never commit: .env.local, PDFs, API keys
├── package.json                   # Monorepo (pnpm workspaces)
└── pnpm-workspace.yaml
```

### System Architecture
```
User on Job Board
    ↓
Content Script (content.ts)
├─ Detect board (LinkedIn, Indeed, etc.)
├─ Extract JD text + parse HTML
├─ Crawl form fields (name, email, resume, custom Q's)
├─ Inject extension button into page
└─ Send to Background: ExtractedJobData

Background Worker (background.ts)
├─ Receive extracted data from content
├─ Store in chrome.storage.session
└─ Notify side panel

Side Panel (side-panel.tsx)
├─ Display extracted data (editable)
├─ Show form fields detected
├─ User selects model + effort level
├─ Button: "Generate Tailored Resume"
    ↓
Codex (Pro, local)
    ├─ User runs /apply-to-job skill
    ├─ [5-stage pipeline runs]
    │   ├─ Stage 1: Parse JD → keywords
    │   ├─ Stage 2: Query pgvector corpus → top-K experiences
    │   ├─ Stage 3: Rewrite resume bullets (anchor-validated)
    │   ├─ Stage 4: LaTeX assembly → compile to PDF (local tectonic binary)
    │   └─ Stage 5: Generate cover letter (markdown)
    ├─ Return: ApplyJobOutput
    └─ User reviews plausibility report ✓
    
Side Panel (resumes tab)
├─ Show tailored resume preview
├─ Show cover letter
├─ User approves or revises
    ↓
Side Panel (form auto-fill tab)
├─ Auto-fill: name, email, resume (PDF), cover letter
├─ Suggest answers to custom questions
├─ User reviews + edits all fields
    ↓
Form Submission (manual, on LinkedIn/Indeed)
├─ User clicks form "Submit" button (extension does NOT)
├─ Extension logs application to dashboard
└─ Saves tailored resume version + metadata

Next.js Dashboard (http://localhost:3000)
├─ Applications board (company, role, date, status)
├─ Resume versions (side-by-side diffs)
├─ JD archive (searchable, taggable)
└─ Analytics (submit rate, interview rate, keyword performance)
```

---

## Development Commands

### Extension
```bash
# Watch + rebuild on changes (Vite)
pnpm dev:extension

# Type check (extension)
pnpm type-check

# Test extraction logic
pnpm test:extension

# Build for production (creates dist/)
pnpm build:extension

# Debug: Open extension service worker DevTools
# chrome://extensions → Find ApplyMate → Details → Inspect views (service worker)
```

### Dashboard
```bash
# Start dev server (http://localhost:3000)
pnpm dev:dashboard

# Build for production
pnpm build:dashboard

# Bridge server (extension → SQLite persistence)
pnpm bridge
pnpm test:bridge
pnpm type-check:bridge
```

### Skill
```bash
# Test skill (unit tests for each stage; DB tests skip without Postgres)
pnpm test:skill

# Type check
pnpm type-check:skill

# Optional local Postgres + pgvector (in-memory KNN fallback works without it)
pnpm skill:db:up
pnpm skill:db:down

# Manual LLM path: validate pasted Codex.ai response, assemble, publish
pnpm skill:manual
```

### All
```bash
# Install all dependencies
pnpm install

# Run extension tests (default)
pnpm test
```

---

## Key Concepts

### 1. Message Flow (Extension → Skill → Dashboard)
Extension (side panel) + Codex + Dashboard don't share direct memory. Data flows:
- Content script → Background → Side panel: `ExtractedJobData`
- Side panel → Codex (user copy-pastes prompt OR extension opens URL)
- Codex ↔ Skill: `/apply-to-job` input/output via chat
- Dashboard ↔ SQLite: applications, resume versions, JD archive persisted locally

**Important**: No cloud sync by default. Versions stored in `~/.applymate/applications/`.

### 2. The 5-Stage Pipeline (in `packages/skill/src/stages/`)
Each stage is a pure function that takes input, validates, returns output.

```typescript
// Stage 1: Parse JD
parsedJD = parseJobDescription(jobDescription)
// → { keywords, skills, seniority, techStack, ... }

// Stage 2: Semantic Retrieval
experiences = queryVectorDB(parsedJD.keywords)
// → [ { experienceId, relevanceScore, suggestedBullet }, ... ]

// Stage 3: Anchor-Validated Rewriting
revivals = rewriteBullets(masterResume, experiences, parsedJD)
// → For each bullet: { original, revised, changes, invariant_checks ✓ }

// Stage 4: LaTeX Assembly
latex = assembleLatex(templateLatex, revisions)
pdf = compileToPDF(latex)  // local tectonic binary via dashboard /api/compile
// → Both LaTeX string + PDF base64

// Stage 5: Cover Letter
coverLetter = generateCoverLetter(company, parsedJD, experiences)
// → Markdown string
```

### 3. Anchor Validation (Core Safety Check)
Keyword injection must validate against user's **experience corpus** (`~/.applymate/experience.yaml`). Never hallucinate skills.

**Example**:
```yaml
# experience.yaml
- id: "rust-async-http"
  title: "Built HTTP server in Rust"
  skills: [rust, async-await, concurrency, http]
  metrics: "10k req/s, <100ms latency"
  anchor: "Expert in async Rust systems programming"
```

When rewriting a bullet, if JD says "Rust + async", we inject only if corpus has that anchor. If JD says "Rust + Go", we only inject "Rust" (Go not in corpus).

**File**: `packages/skill/src/validators/invariant-checks.ts`

### 4. Resume Versioning
Each application saves a unique version:
```
~/.applymate/applications/
├── 2025-01-15-acme-senior-rust-engineer/
│   ├── metadata.json           # { timestamp, company, jobTitle, model, effort, status }
│   ├── job-description.md      # Extracted JD (reference)
│   ├── resume-tailored.tex     # Generated LaTeX
│   ├── resume-tailored.pdf     # Compiled PDF
│   ├── cover-letter.md         # Generated markdown
│   └── form-responses.json     # { fieldName: answer, ... }
```

Dashboard queries this directory, shows diffs, tracks which version got interviews.

### 5. Form Field Detection
Content script crawls `<form>` elements, finds inputs/textareas/selects. Returns structured `FormField[]`:
```typescript
interface FormField {
  id: string;              // HTML id or name
  label: string;           // Visible label text
  type: "text" | "textarea" | "select" | "email" | "file" | ...;
  placeholder?: string;
  isRequired: boolean;
  options?: string[];      // For selects
}
```

Heuristic detection is ~90% accurate. User can manually add/edit fields in side panel.

### 6. Never Auto-Submit
Hard constraint. Extension stops at form preview step. User manually clicks submit on LinkedIn/Indeed/etc. Rationale: accidents happen. Always review.

---

## Important Files to Know

| File | Purpose |
|------|---------|
| `README.md` | Full spec (read first!) |
| `packages/extension/src/content/content.ts` | Job board detection + extraction logic |
| `packages/extension/src/ui/side-panel.tsx` | Main UI (3 tabs: data review, tailoring, form fill) |
| `packages/extension/src/types.ts` | `ExtractedJobData`, `FormField`, etc. |
| `packages/skill/src/stages/rewrite.ts` | Anchor-validated keyword injection (core) |
| `packages/packages/skill/src/validators/invariant-checks.ts` | Plausibility + hallucination checks |
| `packages/dashboard/lib/db.ts` | SQLite queries (applications, versions) |
| `lib/shared/types.ts` | Cross-package types |
| `.env.example` | Config template (never commit .env.local) |

---

## Testing Strategy

### Unit Tests (per stage)
```bash
# Test JD parsing
pnpm test:skill -- --testNamePattern="Stage 1"

# Test vector retrieval
pnpm test:skill -- --testNamePattern="Stage 2"

# Test anchor validation (critical)
pnpm test:skill -- --testNamePattern="invariant-checks"
```

### Integration Tests
```bash
# Test full 5-stage pipeline
pnpm test:skill -- --testNamePattern="pipeline"

# Test extension extraction on real HTML
pnpm test:extension -- --testNamePattern="LinkedIn"
```

### E2E
No automated E2E suite yet; verify manually: load extension → extract on a real
posting → generate (skill or manual-LLM path) → autofill → check dashboard.

Focus: **anchor validation tests** are critical. Every change to rewriting logic must pass these.

---

## Local Development Workflow

### Typical Session
1. **Start dev servers**:
   ```bash
   pnpm dev:extension &
   pnpm dev:dashboard &
   ```

2. **Load extension in Chrome** (if not already):
   - `chrome://extensions` → Load unpacked → select `packages/extension/dist`

3. **Edit + test**:
   - Modify content script → Vite auto-rebuilds → Chrome auto-reloads
   - Modify side panel → Vite auto-rebuilds → Refresh side panel (Cmd+R)
   - Modify skill → Test in Codex with `/apply-to-job` + sample input

4. **Run full test suite**:
   ```bash
   pnpm test
   ```

5. **Debug extraction**:
   - Open DevTools on any job board
   - Console → Extension has logged extracted data
   - Or: inspect Background service worker (see instructions in Extension section)

### Debugging Tips
- **Content script issues**: Check Chrome DevTools on the job posting page
- **Background worker issues**: `chrome://extensions` → Details → "Inspect views (service worker)"
- **Side panel issues**: Right-click on side panel → "Inspect" → DevTools
- **Skill issues**: Codex chat shows detailed error messages

---

## Deployment

### Chrome Extension
1. Build: `pnpm build:extension`
2. Test locally (load unpacked)
3. Publish to Chrome Web Store (or share as `.crx` for sideloading)

### Next.js Dashboard
- Run locally: `pnpm dev:dashboard` (no deployment needed for MVP)
- Optional: Deploy to Vercel (`vercel deploy`)

### Skill
- Registered in Codex automatically (via `/apply-to-job` handler)
- No deployment needed (runs locally on Pro plan)

---

## Key Design Decisions (Why These Choices?)

| Decision | Why |
|----------|-----|
| **No Codex API** | User already on Pro plan; no extra cost; works offline |
| **Local resume storage** | Privacy; deterministic workflow; supports versioning |
| **pgvector for retrieval** | Semantic search > keyword search for finding relevant experience |
| **Anchor-validated rewriting** | Prevents hallucinated skills; all claims backed by corpus |
| **Local tectonic binary for PDF** | Zero server cost; instant client-side compilation |
| **SQLite for dashboard** | Small data volume; no external DB; portable |
| **Never auto-submit** | User always reviews; prevents accidents |
| **5-stage pipeline** | Separation of concerns; each stage testable independently |

---

## Common Tasks

### Add Support for New Job Board
1. Create detector in `packages/extension/src/content/detectors/new-board.ts`
2. Export from `detectors/index.ts`
3. Content script checks URL pattern + runs detector
4. Write extraction logic (JD + form fields)
5. Add tests
6. Test on real job posting

### Improve Resume Rewriting
1. Edit experience corpus (`~/.applymate/experience.yaml`)
   - Add new projects or skills
   - Refine `anchor` field (how to use this experience)
2. Modify `packages/skill/src/stages/rewrite.ts` if needed
3. Run tests: `pnpm test:skill -- --testNamePattern="invariant"`
4. Test end-to-end with sample JD in Codex

### Add Dashboard Feature
1. Design schema addition (if needed) → `packages/dashboard/migrations/`
2. Implement queries in `lib/db.ts`
3. Create Next.js page in `app/`
4. Test with real data

---

## No-Nos

❌ **Do NOT**:
- Commit `.env.local` or any API keys
- Auto-submit the form (extension must stop at review)
- Hallucinate skills not in corpus (anchor validation is critical)
- Store resume PDFs in git (they're in `~/.applymate/applications/` only)
- Use Codex API (user is on Pro plan, use locally)
- Change the 5-stage pipeline logic without tests

✅ **DO**:
- Test anchor validation after any rewriting change
- Keep master resume (`~/.applymate/resume-master.tex`) as single source of truth
- Always show plausibility report + reasoning to user
- Never auto-submit; always show final review step
- Test extraction on 2+ job boards before pushing

---

## Resources

- **README.md** — Full spec, flows, success criteria
- **Skill Input/Output** — `packages/skill/types.ts`
- **Extension Types** — `packages/extension/src/types.ts`
- **5-Stage Logic** — `packages/skill/src/stages/` (each stage ~100-200 LOC)
- **Invariant Checks** — `packages/packages/skill/src/validators/invariant-checks.ts` (core logic)

---

## Questions?

Refer to README.md first (covers all design decisions, flows, edge cases).
If specific implementation detail unclear, check the stage handlers + test files.
