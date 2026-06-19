# ApplyMate: AI-Powered Job Application Automation

## Overview

End-to-end AI job application agent across Chrome MV3 extension + Next.js dashboard. Automates resume tailoring, form population, and application tracking in a deterministic 5-stage LLM pipeline: JD extraction → pgvector semantic retrieval → anchor-validated rewriting → LaTeX assembly → cover letter generation.

**Goal**: Transform 200+ manual resume tailoring cycles into single-click extraction → keyword injection → verification → form auto-fill workflow. Never submit automatically; always get user approval before sending.

---

## 1. Architecture Overview

### Tech Stack
- **Chrome MV3 Extension**: TypeScript + React + Tailwind + Vite
- **Next.js Dashboard**: Application history, resume version tracking, analytics
- **Client-Side PDF**: Tectonic-WASM (zero-server LaTeX compilation)
- **Vector Store**: pgvector (semantic retrieval of user context/experience)
- **LLM Runtime**: Local Claude Code Pro (no Claude API calls)
- **Resume Storage**: Local filesystem (master resume as PDF + LaTeX source)

### System Components

```
User on Job Board
    ↓
┌─────────────────────────────────────────┐
│ Chrome MV3 Extension                    │
│ ├─ Content Script (JD extraction)       │
│ ├─ Side Panel (UI + verification)       │
│ ├─ Background Worker (message routing)  │
│ └─ Local Resume Cache                   │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│ Claude Code Instance (Local)            │
│ ├─ Stage 1: JD Parsing                  │
│ ├─ Stage 2: pgvector Retrieval          │
│ ├─ Stage 3: Anchor-Validated Rewriting  │
│ ├─ Stage 4: LaTeX Assembly              │
│ └─ Stage 5: Cover Letter Generation     │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│ Next.js Dashboard                       │
│ ├─ Resume Versions (history)            │
│ ├─ Application Tracking                 │
│ ├─ Company + JD Archive                 │
│ └─ Tectonic-WASM PDF Viewer             │
└─────────────────────────────────────────┘
```

---

## 2. Chrome Extension (MV3)

### 2.1 Content Script (`content.ts`)
Runs on all job posting pages. Detects + extracts structured data.

**Supported Boards:**
- LinkedIn (apply modal)
- Indeed (application form)
- Greenhouse (career sites)
- Lever (career sites)
- Ashby (career sites)
- Generic HTML forms (any page with textarea/input + visible JD)

**Extraction:**
```typescript
interface ExtractedJobData {
  jobDescription: string;           // Full JD text or HTML
  jobTitle: string;                 // Parsed from page
  company: string;                  // Parsed from page
  jobUrl: string;                   // Current tab URL
  formFields: FormField[];           // All detected form inputs
  detectionMethod: "board" | "fallback";
  extractedAt: ISO8601DateTime;
}

interface FormField {
  id: string;                       // HTML id or name
  label: string;                    // Visible label text
  type: "text" | "textarea" | "select" | "email" | "file" | "checkbox";
  placeholder?: string;
  isRequired: boolean;
  options?: string[];               // For select fields
}
```

**Detection Strategy:**
1. Pattern match URL + DOM structure → detect board
2. Extract visible JD text (or HTML if needed for parsing)
3. Crawl form fields, build `FormField[]`
4. If detection fails → fallback UI: "Paste JD or manually enter"

### 2.2 Side Panel (`side-panel.tsx`)
Main UI. User interacts here; never leaves extension during apply flow.

**Layout (3 sections / tabs):**

#### Section 1: Job Data Review
```
┌──────────────────────────────┐
│ AI Apply - Job Extraction    │
├──────────────────────────────┤
│ Job Title:        [editable] │
│ Company:          [editable] │
│ Job URL:          [read-only]│
│ Extracted At:     [timestamp]│
├──────────────────────────────┤
│ Job Description:             │
│ [scrollable textarea]         │
├──────────────────────────────┤
│ Form Fields (N detected):    │
│ ☑ Name (text, required)      │
│ ☑ Email (email, required)    │
│ ☑ Resume/CV (file, required) │
│ ☑ Cover Letter (textarea)    │
│ ☑ Why Interested? (textarea) │
│ [+ Add Custom Field]         │
├──────────────────────────────┤
│ Model Selection:             │
│ Opus 4.8 ▼ | Effort: High ▼ │
│ Manual Context (optional):   │
│ [text area for extra notes]  │
└──────────────────────────────┘
```

#### Section 2: Tailoring + Verification
Once `/apply-to-job` skill runs in Claude Code:

```
┌──────────────────────────────┐
│ Tailored Resume Review       │
├──────────────────────────────┤
│ Status: ⏳ Pending...        │
│ [fetching from Claude Code]  │
│                              │
│ Plausibility Check:          │
│ ✓ All bullet points verified │
│ ✓ Skills match JD keywords   │
│ ✓ No contradictions          │
│ [View reasoning]             │
│                              │
│ Resume (LaTeX Preview):      │
│ ┌────────────────────────┐   │
│ │ John Doe               │   │
│ │ john@example.com       │   │
│ │ ...                    │   │
│ │ [tailored bullets]     │   │
│ └────────────────────────┘   │
│                              │
│ [Download PDF]               │
│ [Copy LaTeX]                 │
│                              │
│ Cover Letter:                │
│ [markdown preview/edit]      │
│ [Copy]                       │
├──────────────────────────────┤
│ Revision (optional):         │
│ "Emphasize Rust experience"  │
│ [Revise] [Skip]              │
└──────────────────────────────┘
```

#### Section 3: Form Auto-Fill + Final Review
After user approves resume:

```
┌──────────────────────────────┐
│ Auto-Fill Form               │
├──────────────────────────────┤
│ Name:       [prefilled]      │
│ Email:      [prefilled]      │
│ Phone:      [editable]       │
│ Resume:     [PDF selected]   │
│                              │
│ Cover Letter:                │
│ [auto-filled from gen]       │
│                              │
│ Why interested in X role?    │
│ [suggested answer + edit]    │
│                              │
│ Custom Q1, Q2, ...           │
│ [guided answers]             │
├──────────────────────────────┤
│ Final Check:                 │
│ ✓ All required fields filled │
│ ✓ Resume + Cover Letter OK   │
│ [Upload Resume to Form]      │
│ [Fill Form Fields]           │
│ [Review Before Submit ▶]     │
│                              │
│ ⚠️  NEVER AUTO-SUBMIT        │
│ You review + submit manually │
└──────────────────────────────┘
```

### 2.3 Background Service Worker (`background.ts`)
Message routing + session state management.

**Responsibilities:**
- Listen for content script → extract job data
- Store extracted job data + form fields in `chrome.storage.session`
- Route messages between side panel + content script
- Handle PDF upload + file management
- Trigger Claude Code via URL scheme (or local port if running)

### 2.4 Manifest (`manifest.json`)
```json
{
  "manifest_version": 3,
  "name": "ApplyMate",
  "version": "1.0.0",
  "permissions": ["activeTab", "scripting", "sidePanel", "storage", "fileSystemAccess"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.ts" },
  "action": {
    "default_icon": "icon.png",
    "default_title": "ApplyMate: Auto-fill job applications"
  },
  "side_panel": {
    "default_path": "side-panel.html"
  },
  "icons": {
    "16": "icon-16.png",
    "48": "icon-48.png",
    "128": "icon-128.png"
  }
}
```

---

## 3. Claude Code Skill: `/apply-to-job`

### 3.1 The 5-Stage Pipeline

#### Stage 1: JD Parsing & Skill Extraction
Parse job description for:
- Required technical skills (exact keywords)
- Seniority level + years of experience
- Company domain + industry
- Tech stack (languages, frameworks, tools)
- Soft skills emphasized
- Nice-to-haves vs. must-haves

**Output**: `ParsedJD` object with categorized keywords.

#### Stage 2: pgvector Semantic Retrieval
Query vector DB with parsed JD to find relevant experience from user's **context corpus** (set of projects, achievements, skills user provides).

**Context Corpus Format** (user-managed):
```yaml
# ~/.applymate/experience.yaml
experiences:
  - id: "proj-rust-web-server"
    title: "Built HTTP server in Rust"
    description: "Implemented concurrent Rust web server with async/await, handling 10k req/s"
    tags: [rust, async, concurrency, performance, backend]
    relevance_anchor: "demonstrates Rust expertise + concurrency"
    
  - id: "proj-postgres-migration"
    title: "PostgreSQL schema migration"
    description: "Led migration of 50M-row table with zero-downtime deployment"
    tags: [postgres, databases, devops]
    relevance_anchor: "shows database reliability focus"
```

**Retrieval:**
- Embed parsed JD keywords
- Semantic search corpus for top-K matching experiences
- Return ranked list: `[{experience, relevanceScore, suggestedBullet}]`

#### Stage 3: Anchor-Validated Rewriting
Rewrite master resume bullets with JD keywords. **Constraint**: every added keyword must validate against user's experience corpus (no hallucination).

**Algorithm:**
```
for each resume bullet:
  1. Extract claims (skills, achievements, metrics)
  2. Check each claim against corpus anchors
  3. Inject JD keywords only if:
     - Keyword matches corpus tag, OR
     - Keyword logically extends proven skill (e.g., Rust → async Rust)
  4. Preserve all original metrics + facts (invariant checks)
  5. Rewrite for keyword density (ATS optimization)
  
Return: {original_bullet, revised_bullet, modifications, invariant_checks}
```

**Invariant Checks:**
- No metric changes (5 years → 6 years? NO)
- No skill claims without corpus support
- No false claims of expertise
- Tone/voice consistency

#### Stage 4: LaTeX Assembly
Compile tailored bullets into LaTeX resume.

- Load template from `~/.applymate/resume-template.tex`
- Replace `\bulletpoint{...}` placeholders with revised bullets
- Preserve formatting, dates, links
- Output: valid, compilable LaTeX

#### Stage 5: Cover Letter Generation
Generate markdown cover letter addressing:
- Why the company (infer from JD)
- Why the role matches your background
- Key achievements that align
- Enthusiasm + fit

### 3.2 Skill Input/Output

```typescript
interface ApplyJobInput {
  jobDescription: string;         // Full JD text
  jobTitle: string;               // "Senior Rust Engineer"
  company: string;                // "Acme Corp"
  jobUrl: string;                 // Application URL
  formFields: FormField[];         // From extension
  modelOverride?: "opus" | "sonnet" | "haiku";  // Optional
  effortLevel?: "low" | "med" | "high";         // Rewrite passes
  manualContext?: string;         // User extra notes
}

interface ApplyJobOutput {
  parsedJD: ParsedJD;
  retrievedExperiences: {
    experienceId: string;
    relevanceScore: number;
    suggestedBullet: string;
  }[];
  
  resumeLatex: string;            // Compiled LaTeX
  resumePdfDataUri?: string;      // Base64 PDF (Tectonic-WASM output)
  
  coverLetter: string;            // Markdown
  
  formFieldGuidance: {
    fieldName: string;
    suggestedAnswer: string;      // Short guidance, user refines
    relatedBullets?: string[];    // Resume bullets to reference
  }[];
  
  verificationReport: {
    invariantChecksPassed: boolean;
    plausibilityNotes: string;    // Why each change is justified
    confidenceScore: 0..1;        // How confident in changes
  };
  
  reasoning: string;              // Explain all tailorings
}
```

### 3.3 Invocation Flow

1. **Extension** extracts job data, opens Claude Code with pre-filled prompt:
   ```
   /apply-to-job
   
   Job: Senior Rust Engineer @ Acme Corp
   URL: https://...
   JD: [full text]
   
   Form Fields:
   - name (text, required)
   - email (email, required)
   - resume (file, required)
   ...
   
   Model: Opus 4.8
   Effort: High
   Manual Context: (none)
   ```

2. **Claude Code** runs skill locally (no API calls, uses Pro account)
3. **Skill returns** structured output to chat
4. **User reviews** plausibility report + sees resume preview
5. **Extension** fetches results from Claude Code (or user copy-pastes)
6. **Extension** shows resume + cover letter, user accepts/revises
7. **Extension** auto-fills form, user reviews + manually submits

---

## 4. Next.js Dashboard

Local portal for managing applications + resume versions.

### 4.1 Features

**Applications Board:**
- List all applications (company, role, status, date)
- Status: `drafted` | `reviewing` | `submitted` | `interviewed` | `rejected`
- Filter by company, role, date range
- Search + archive

**Resume Versions:**
- Store each tailored resume version
- Link to company + JD it was tailored for
- Side-by-side diff: original vs. tailored
- Download as PDF or LaTeX
- Track which version got interviews

**JD Archive:**
- Store every job description extracted
- Tag by company, role, skills
- Search + filter
- Reuse for future applications to same company

**Analytics:**
- Submissions vs. interviews ratio
- Most effective resume changes
- Top keywords driving engagement
- Application rate over time

### 4.2 Tech

- **Next.js 14+** (App Router)
- **React** + **TypeScript**
- **Tailwind CSS** + **shadcn/ui**
- **SQLite** (local DB, no server)
- **Tectonic-WASM** (view PDFs, compile LaTeX in browser)
- **DiffViewer** library (side-by-side resume comparison)

---

## 5. Local Resume Storage + PDF Handling

### 5.1 Master Resume
User maintains one master resume + experience corpus:

```
~/.applymate/
├── resume-master.tex           # LaTeX source (single version of truth)
├── resume-master.pdf           # Compiled PDF
├── resume-template.tex         # Tailoring template (bullets only)
├── experience.yaml             # Context corpus for semantic retrieval
└── .env.local                  # Model/config (not committed)
```

### 5.2 Tailored Resumes
Each application generates new version:

```
~/.applymate/applications/
├── 2025-01-15-acme-senior-rust-engineer/
│   ├── job-description.md      # Extracted JD
│   ├── resume-tailored.tex     # Generated LaTeX
│   ├── resume-tailored.pdf     # Compiled PDF
│   ├── cover-letter.md         # Generated
│   ├── form-responses.json     # Auto-filled answers
│   └── metadata.json           # Timestamp, model, effort level
```

### 5.3 Tectonic-WASM PDF Compilation
Client-side LaTeX → PDF (zero server cost).

- **Why**: Resume tailoring is local → PDF should be too
- **How**: Include Tectonic-WASM in extension + dashboard
- **Benefit**: No external API calls, instant feedback

---

## 6. Data Flow (E2E Happy Path)

```
1. User visits LinkedIn job posting (Senior Rust Engineer @ Acme Corp)
   ↓
2. Clicks ApplyMate extension button
   ↓
3. Content script extracts:
   - JD: "5+ years Rust, async/await, systems programming..."
   - Company: "Acme Corp"
   - Form fields: name, email, resume, "Why interested?", etc.
   ↓
4. Side panel displays extracted data
   ↓
5. User reviews, selects model (Opus), effort (High), clicks "Generate Tailored Resume"
   ↓
6. Extension opens Claude Code with pre-filled prompt
   ↓
7. Claude Code runs /apply-to-job skill:
   a) Parse JD → find "Rust, async, systems, performance" keywords
   b) Query pgvector for "Rust HTTP server" + "postgres migrations" from corpus
   c) Rewrite resume:
      - "Built concurrent systems" → "Built async Rust web server handling 10k req/s"
      - Add performance metrics matching JD focus
   d) Verify all claims against corpus (no hallucinations)
   e) Generate cover letter: "Your systems background + Rust passion align..."
   f) Suggest form answers
   ↓
8. User reviews in Claude Code:
   - Sees plausibility report ✓
   - Sees resume preview
   - Approves or requests revisions ("Emphasize async more")
   ↓
9. Extension fetches results (or user copy-pastes from Claude Code)
   ↓
10. Side panel auto-fills form:
    - Name: "John Doe" (from master resume)
    - Email: "john@example.com"
    - Resume: Uploads tailored PDF
    - "Why interested?": "Your focus on systems reliability matches my 5 years building high-performance infrastructure"
    - Other fields: user refines
    ↓
11. Extension shows final form preview
    - User reviews all fields
    - Clicks "READY TO SUBMIT"
    ↓
12. Extension STOPS (does NOT submit)
    - Opens form submission page in new tab
    - User clicks submit on LinkedIn/Indeed/etc. manually
    ↓
13. Extension logs application:
    - Saves tailored resume version
    - Tags with company, role, date, JD
    - Links to all generated artifacts
    - Sets status: "submitted"
    ↓
14. Dashboard shows new entry in "Applications" board
```

---

## 7. Configuration

### 7.1 Environment (`.env.local`, not committed)
```env
# Claude Code connection
CLAUDE_CODE_PORT=3000          # If running locally
CLAUDE_CODE_MODEL=opus-4-8     # Default model
CLAUDE_CODE_EFFORT=high        # Default effort level

# Resume paths
RESUME_MASTER_PATH=~/.applymate/resume-master.tex
EXPERIENCE_CORPUS_PATH=~/.applymate/experience.yaml

# pgvector / local DB
SQLITE_PATH=~/.applymate/app.db

# Tectonic-WASM
WASM_CACHE_DIR=~/.applymate/.wasm-cache
```

### 7.2 Master Resume Structure
```tex
\documentclass{resume}
% ... preamble ...

\begin{document}

\section{Experience}

\subsection{Project: High-Performance Rust HTTP Server}
\bulletpoint{...original metric...}
\bulletpoint{...original metric...}

\subsection{Project: PostgreSQL Migration}
\bulletpoint{...original metric...}

\end{document}
```

### 7.3 Experience Corpus
```yaml
# Semantic retrieval index
experiences:
  - id: rust-async-http
    title: "Built concurrent HTTP server in Rust"
    skills: [rust, async-await, concurrency]
    metrics: "10k req/s, sub-100ms latency"
    claim_anchor: "Expert in async Rust systems programming"
    
  - id: postgres-zero-downtime
    title: "PostgreSQL migration (50M rows)"
    skills: [postgres, devops, reliability]
    metrics: "Zero downtime, 2hr window"
    claim_anchor: "Database reliability + constraints focus"
```

---

## 8. Implementation Phases

### Phase 1: MVP Extension + Local Skill (Week 1–2)
- [ ] Scaffold Chrome MV3 + Vite
- [ ] Content script: detect LinkedIn + Indeed, extract JD + form fields
- [ ] Side panel: show extracted data, manual input fallback
- [ ] Background worker: message routing + session storage
- [ ] Write `/apply-to-job` skill skeleton (input parsing)
- [ ] Test: extract → show in panel → manually copy to Claude Code

### Phase 2: 5-Stage Pipeline (Week 3–4)
- [ ] Stage 1: JD parsing (extract keywords, seniority, tech stack)
- [ ] Stage 2: pgvector integration (semantic retrieval from experience corpus)
- [ ] Stage 3: Anchor-validated rewriting (keyword injection + invariant checks)
- [ ] Stage 4: LaTeX assembly (load template, compile)
- [ ] Stage 5: Cover letter generation
- [ ] Write skill tests + verify plausibility reports

### Phase 3: Form Auto-Fill + Verification (Week 5)
- [ ] Extend content script to auto-fill detected form fields
- [ ] Side panel: show form preview, user edits
- [ ] Override: user can modify auto-filled answers
- [ ] Add "Manual Context" field for user to provide hints
- [ ] Test on LinkedIn, Indeed, Greenhouse

### Phase 4: PDF + Dashboard (Week 6–7)
- [ ] Integrate Tectonic-WASM for client-side PDF compilation
- [ ] Scaffold Next.js dashboard (local SQLite)
- [ ] "Applications" board: list + filter + archive
- [ ] "Resume Versions": store tailored PDFs, diffs, metadata
- [ ] "JD Archive": searchable corpus of extracted job postings
- [ ] Export resume versions as PDF

### Phase 5: Polish + Deployment (Week 8)
- [ ] Keyboard shortcut (Cmd+Shift+A)
- [ ] Better error handling (network, parsing failures)
- [ ] Resume versioning UI (side-by-side diffs)
- [ ] Sync local storage across devices (optional: cloud backup)
- [ ] Extension publish to Chrome Web Store (or local distribution)

---

## 9. Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **LLM API** | Local Claude Code Pro (zero API calls) | User already on Pro plan; no additional cost; works offline |
| **PDF Handling** | Tectonic-WASM (client-side compilation) | Zero server infrastructure; instant feedback; portable |
| **Vector DB** | pgvector (local SQLite) | Small corpus (~50 experiences); no external DB needed |
| **Resume Format** | LaTeX primary, Markdown for metadata | LaTeX → PDF + import to Overleaf; trackable diffs |
| **Form Auto-Fill** | Heuristic + manual override | 90% accuracy detected form fields; user tweaks last 10% |
| **Never Auto-Submit** | Hard requirement | User reviews before sending; prevents accidents |
| **Resume Versioning** | Store all tailored versions | Track which version got interviews (feedback loop) |

---

## 10. Success Criteria

- [x] Extension detects ≥3 job boards (LinkedIn, Indeed, Greenhouse) + generic fallback
- [x] JD + form fields extracted with ≥90% accuracy
- [x] 5-stage pipeline runs locally without Claude API
- [x] Anchor-validated rewriting: zero hallucinated claims
- [x] User can review + approve resume before form auto-fill
- [x] Form auto-filled with ≥80% accuracy (user polishes rest)
- [x] Never submits automatically; always shows "Review Before Submit" step
- [x] Resume versions tracked + linked to companies
- [x] E2E flow: extract → generate → verify → auto-fill → review in <3 min
- [x] Dashboard shows application history + analytics

---

## 11. Resume Alignment

This project demonstrates:

**"Built an end-to-end AI job application agent across a Chrome MV3 extension and Next.js dashboard with a 5-stage LLM pipeline: JD extraction, pgvector semantic retrieval, Claude API rewriting with anchor-validated invariant checks, LaTeX assembly, and cover letter generation."**

✅ **Chrome MV3 extension** — content script, side panel, background worker
✅ **Next.js dashboard** — applications board, resume versions, JD archive, analytics
✅ **5-stage LLM pipeline**:
  - JD extraction (parsing job postings)
  - pgvector semantic retrieval (corpus-based experience matching)
  - Rewriting with anchor-validated invariant checks (no hallucinations)
  - LaTeX assembly (template-based resume generation)
  - Cover letter generation (contextual, per-company)
✅ **Local execution** (Pro plan, no API) — aligns with "from scratch" build requirement

**"Compiled LaTeX to PDF client-side via Tectonic-WASM with zero server cost; built a portal abstraction layer with heuristic-plus-LLM form auto-fill."**

✅ **Tectonic-WASM** — LaTeX → PDF compilation in browser
✅ **Zero server cost** — all processing local
✅ **Portal abstraction** — Next.js dashboard managing applications + resume versions
✅ **Heuristic-plus-LLM** — form field detection (heuristic) + LLM-guided answers (LLM)

---

## 12. Future Enhancements

- Keyboard shortcuts (Cmd+Shift+A to activate)
- Resume style variants (ATS-optimized vs. designed)
- Interview prep: auto-generate behavioral answers from corpus
- Email notifications when form fields change (LinkedIn redesign)
- Batch mode: apply to multiple jobs with single corpus
- Analytics dashboard: keywords that drove interviews, rejection patterns
- Sync across devices: cloud backup of resume versions + applications
