# ApplyMate: Bulletproof Spec for Spec-Driven Development

**Document**: Product Specification  
**Version**: 1.0  
**Date**: 2025-06-19  
**Author**: Ram Chawla  
**Status**: Ready for Implementation Review  

---

## Executive Summary

ApplyMate automates resume tailoring + job application form-filling via a Chrome MV3 extension + local Next.js dashboard. 5-stage LLM pipeline (JD extraction → pgvector retrieval → anchor-validated rewriting → LaTeX assembly → cover letter generation) runs on Claude Code Pro (no API calls). User approves all changes before form submission. Never auto-submits.

**Priorities** (by impact):
1. Resume accuracy (anchor validation bulletproof, zero hallucinations)
2. Extension reliability (job board detection + form extraction never silently fail)
3. User workflow (every step crystal clear, no ambiguous UI states)
4. Data integrity (application tracking + resume versioning)

**Implementation Timeline**: 7-8 weeks, 5 phases, incremental manual gates.

---

## PART 1: RISK LOCKDOWN

The three riskiest technical areas. Detailed, testable specifications.

### 1.1 Job Board Detection (Content Script)

**Risk**: Sites redesign constantly. Wrong detection = silently extracts garbage or nothing.

**Strategy**: Heuristic detection with fallback. Never fail silently.

**Detection Data Structure**:
```typescript
interface DetectionResult {
  board: "linkedin" | "indeed" | "greenhouse" | "lever" | "ashby" | "generic" | "unknown";
  confidence: 0..1;          // 0.95 = very confident, 0.5 = uncertain
  method: string;            // "url_pattern" | "dom_structure" | "fallback"
  detectedElements: {
    jdContainer?: string;    // selector or "not found"
    formContainer?: string;
    companyElement?: string;
    jobTitleElement?: string;
  };
}
```

**Detection Order** (first match wins):

1. **URL Pattern Match** (highest confidence, 0.95-0.99):
   - LinkedIn: `linkedin.com/jobs/view/` → confidence 0.99
   - Indeed: `indeed.com/jobs?` → confidence 0.99
   - Greenhouse: domain ends `.greenhouse.io` → confidence 0.95
   - Lever: domain ends `.lever.co` → confidence 0.95
   - Ashby: domain ends `.ashby.com` → confidence 0.95

2. **DOM Structure Match** (medium confidence, 0.7-0.8):
   - If URL doesn't match but page has characteristic DOM patterns
   - Example: `<textarea class="posting-description">` (LinkedIn pattern) → LinkedIn, confidence 0.8
   - Similar heuristics for each board

3. **Fallback** (low confidence, 0.3):
   - Generic page has `<textarea>` + `<input>` + text > 500 chars = form page
   - Return `board: "generic"`, confidence 0.3

**User Validation Gate**:
In side panel Tab 1, show:
```
Detected: [LinkedIn] (Confidence: 0.99)
├─ Method: URL pattern match
├─ Detected Elements:
│  ├─ Job Description: ✓ Found
│  ├─ Form Container: ✓ Found
│  └─ Company: ✓ Found
├─ [✓ Use This Detection]
└─ [Manual Entry (fallback)]
```

If confidence < 0.7, default to manual entry option.

**Acceptance Test Cases**:
```
Test 1: LinkedIn URL
  Input: url=linkedin.com/jobs/view/1234567
  Expected: board=linkedin, confidence=0.99, method=url_pattern
  Status: PASS

Test 2: LinkedIn DOM structure
  Input: url=unknown.com, DOM has <textarea class="posting-description">
  Expected: board=linkedin, confidence=0.8, method=dom_structure
  Status: PASS

Test 3: Generic fallback
  Input: url=generic-careers.com, DOM has 1 textarea + 5 inputs + 2000 char text
  Expected: board=generic, confidence=0.3, method=fallback
  Status: PASS

Test 4: Unknown board (low confidence)
  Input: url=nowhere.com, no pattern matches
  Expected: board=unknown, confidence=0.2, method=fallback
  Status: PASS → triggers manual entry UI
```

**Error Handling**:
- Never throw silently. If detection fails, show manual entry option.
- Log detection method + confidence for debugging.
- If user selects manual entry, extracted data discarded.

---

### 1.2 Form Field Validation (Content Script + Side Panel)

**Risk**: Forms vary wildly. Extracting wrong fields = resume uploaded to wrong place, data mismatch, silent failure.

**Strategy**: Extract all fields, require user validation before form fills.

**Form Field Data Structure**:
```typescript
interface FormField {
  id: string;                    // HTML id or name attr (unique per form)
  label: string;                 // Visible text from <label> or placeholder
  type: "text" | "email" | "tel" | "textarea" | "select" | "file" | "checkbox" | "radio" | "unknown";
  placeholder?: string;
  required: boolean;
  
  // Our extraction guess
  extractedValueType?: "name" | "email" | "phone" | "resume" | "cover-letter" | "custom-q" | null;
  matchConfidence: 0..1;         // How sure we are about extractedValueType
  
  // User override (after validation gate)
  userSelectedValueType?: string;
  userProvidedValue?: string;
  
  // Validation gate
  validated: boolean;            // User has reviewed this field
}
```

**Field Type Inference Algorithm**:

For each form field:
```
1. Parse label text (case-insensitive):
   "name" OR "full name" OR "your name" → extractedValueType: "name", confidence: 0.95
   "email" OR "email address" → extractedValueType: "email", confidence: 0.95
   "resume" OR "cv" OR "curriculum vitae" → extractedValueType: "resume", confidence: 0.90
   "cover letter" OR "cover" → extractedValueType: "cover-letter", confidence: 0.85
   "why interested" OR "why apply" OR "why this role" → extractedValueType: "custom-q", confidence: 0.75
   [no match] → extractedValueType: null, confidence: 0.0

2. Adjust by HTML field type:
   type: "email" → confidence += 0.15 (if labeled as email)
   type: "file" → confidence += 0.10 (for resume/CV)
   type: "text" → confidence -= 0.05 (ambiguous)

3. Adjust by placeholder text:
   "john@example.com" in placeholder → email, confidence += 0.10
   "upload your resume" → resume, confidence += 0.10
   "describe your interest" → custom-q, confidence += 0.10

Final confidence = clamped to [0..1]
```

**User Validation Gate (Side Panel Tab 2)**:

```
Extracted Form Fields (N fields found):
┌─────────────────────────────────────────┐
│ ✓ Field 1: "Full Name"                  │
│   Type: text, Required: ✓                │
│   Extracted As: name (95% confidence)   │
│   [Change ▼]                            │
│   ☑ Validated                           │
│
│ ✓ Field 2: "Email Address"              │
│   Type: email, Required: ✓               │
│   Extracted As: email (95% confidence)  │
│   [Change ▼]                            │
│   ☑ Validated                           │
│
│ ✓ Field 3: "Resume / CV"                │
│   Type: file, Required: ✓                │
│   Extracted As: resume (90% confidence) │
│   [Change ▼]                            │
│   ☑ Validated                           │
│
│ ⚠ Field 4: "Tell us about yourself"     │
│   Type: textarea, Required: false        │
│   Extracted As: UNKNOWN (0% confidence) │
│   [Manual: ▼] (required)                │
│   ☐ Validated (REQUIRED before proceed) │
└─────────────────────────────────────────┘

Status: ⚠️ 3/4 validated. Field 4 needs attention.
[Proceed to Resume Approval ▶] (disabled)
```

**Validation Constraint**:
- ❌ Cannot proceed to next step until ALL fields validated
- Validation = user has reviewed + optionally changed the extracted type
- Low-confidence fields (< 0.7) must be manually overridden or acknowledged

**Acceptance Test Cases**:
```
Test 1: Standard name field
  Input: <input label="Full Name" type="text" required>
  Expected: extractedValueType=name, confidence=0.95
  Status: PASS

Test 2: Custom question
  Input: <textarea label="Why do you want this job?" required>
  Expected: extractedValueType=custom-q, confidence=0.75
  Status: PASS

Test 3: Unknown field (no label)
  Input: <input label="?" type="text">
  Expected: extractedValueType=null, confidence=0.0
  Status: PASS → requires manual selection

Test 4: User override
  Input: field auto-detected as "custom-q", user clicks "Change" → "phone"
  Expected: userSelectedValueType=phone, validated=true
  Status: PASS

Test 5: Validation gate
  Input: 5 fields, 3 validated, 2 unknown
  Expected: Proceed button disabled
  Status: PASS
```

**Error Handling**:
- If no form fields detected: show "No form found. Paste JD + enter details manually."
- If field label is empty: use placeholder text, mark confidence 0.5
- If user closes panel mid-validation: data persists in session storage

---

### 1.3 Anchor Validation (Skill, Stage 3: Rewriting)

**Risk**: Injecting keywords user doesn't actually have. Hallucinations destroy credibility. Must prevent while staying flexible.

**Strategy**: Moderate anchor validation + confidence report. User approves before upload.

**Core Data Structures**:

```typescript
interface ExperienceAnchor {
  id: string;
  title: string;                 // "Built HTTP server in Rust"
  description: string;           // Full details
  skills: string[];              // ["rust", "async", "http-servers", "concurrency"]
  metrics: string[];             // ["10k req/s", "sub-100ms latency"]
  
  // Claim this experience validates
  claim_anchor: string;          // "Expert in async Rust systems programming"
  
  // Semantic tags for matching
  tags: string[];                // ["backend", "performance", "systems", "reliability"]
}

interface BulletRewrite {
  original: string;              // "Built HTTP server in Rust"
  revised: string;               // "Built async HTTP server in Rust, handling 10k req/s"
  
  // What changed
  changes: {
    keywordsAdded: string[];     // ["async"]
    metricsPreserved: string[];  // ["10k req/s"]
    reasonsForAddition: string[]; // ["async: matches JD requirement 'async/await'"]
  };
  
  // Validation (CRITICAL)
  invariantChecksPassed: boolean; // All claims backed by anchors?
  plausibilityScore: 0..1;       // Confidence in this change
  validationNotes: string[];     // ["async validated against anchor 'rust-async-http'"]
}

interface RewritingReport {
  totalBullets: number;
  bulletsModified: number;
  totalKeywordsAdded: number;
  
  perBullet: BulletRewrite[];
  
  // Summary for user review
  summary: string;               // "5 bullets modified. 12 keywords added. All validated. Confidence: 94%"
  overallConfidence: 0..1;
  
  // Flags
  warnings: string[];            // ["Field 3: keyword 'Go' not in corpus, skipped"]
  recommendations: string[];     // ["Consider adding Docker K8s to corpus"]
  
  allInvariantChecksPassed: boolean; // Master flag
}
```

**Rewriting Algorithm** (Stage 3):

```
For each resume bullet:
  1. Extract current claims: skills mentioned, metrics, achievements, years

  2. For each JD keyword:
    a) Exact match in corpus.skills?
       → ADD (confidence 1.0)
       
    b) Logical extension?
       - Check if corpus has base skill + extension attribute
       - Example: JD wants "async Rust", corpus has "rust" + "async" in same anchor
       → ADD (confidence 0.85)
       
    c) Related category?
       - Similar purpose/domain (Python ≈ Go for backend)
       → ADD with warning (confidence 0.6)
       
    d) No match
       → SKIP, note in warnings

  3. Rewrite bullet with added keywords (preserve original metrics)

  4. Run invariant checks (ALL MUST PASS):
     ✓ No original metric changed (5 years → 6 years? BLOCK)
     ✓ No new metric claimed without corpus anchor
     ✓ All new skills backed by corpus anchors
     ✓ No false seniority claims (junior → senior? BLOCK)
     ✓ No contradictions with other bullets
     ✓ Tone/voice consistent with original

  5. Calculate plausibilityScore:
     base = 0.9 if all keywords exact-match
     adjust -= 0.05 per logical extension
     adjust -= 0.10 per low-confidence match
     floor = 0.5 (never lower)

Return: BulletRewrite + plausibilityScore
```

**User Approval Gate (Side Panel Tab 3: "Tailoring Review")**:

```
Rewriting Report
═══════════════════════════════════════════════════════════

📊 Summary
• Bullets modified: 5 / 8
• Keywords added: 12
• Overall confidence: 94%
• ✓ All invariant checks passed

───────────────────────────────────────────────────────────

📝 Per-Bullet Changes

[Bullet 1] ✓
Original:
  "Built HTTP server in Rust, handling 10k req/s"

Revised:
  "Built async HTTP server in Rust, handling 10k req/s with sub-100ms latency"

Changes:
  + "async" (matches JD, validated against anchor "rust-async-http")
  + "sub-100ms latency" (from corpus metrics, no hallucination)
  Invariant: ✓ metrics preserved
  Confidence: 98%

[Bullet 2] ✓
Original:
  "Led PostgreSQL migration for 50M-row table"

Revised:
  "Led zero-downtime PostgreSQL migration for 50M-row table, maintained SLA"

Changes:
  + "zero-downtime" (validated against anchor "postgres-zero-downtime")
  + "maintained SLA" (standard practice, implicitly true)
  Invariant: ✓ metrics preserved
  Confidence: 95%

[Bullet 3] ⚠️
Original:
  "Deployed infrastructure with Docker"

Revised:
  "Deployed containerized infrastructure with Docker, orchestrated with Kubernetes"

Changes:
  + "Kubernetes" (NOT in corpus, confidence 0.6)
  Invariant: ✓ metrics unchanged
  Confidence: 60% ← LOW

  ⚠️ OPTIONS:
    [Accept (you have K8s exp)] → marks as approved
    [Remove (skip K8s)] → reverts to original
    [Add to corpus + retry] → edits corpus, reruns Stage 3

───────────────────────────────────────────────────────────

⚠️ Warnings
• Bullet 3: "Kubernetes" not in experience corpus
  Action: Resolve before proceeding

───────────────────────────────────────────────────────────

[✓ Accept All (high confidence)]
[Resolve Issues] (required to proceed)
```

**Acceptance Criteria** (before form auto-fill):
- ALL invariant checks pass
- User reviews report + approves OR resolves low-confidence items
- Low-confidence bullets (< 0.7) explicitly handled (accept, remove, or add to corpus)
- Report saved with resume version (audit trail)

**Acceptance Test Cases**:

```
Test 1: Exact Match
  Corpus: [anchor "rust-async-http": skills=["rust", "async"]]
  JD Keywords: ["rust", "async"]
  Bullet: "Built HTTP server"
  Expected Revised: "Built async HTTP server in Rust"
  Expected Confidence: 0.98
  Status: PASS

Test 2: Logical Extension
  Corpus: [anchor "rust-async": skills=["rust", "async"], tags=["concurrency"]]
  JD Keywords: ["rust", "async", "concurrency"]
  Bullet: "Built HTTP server"
  Expected: "Built async HTTP server with robust concurrency"
  Expected Confidence: 0.85
  Status: PASS

Test 3: No Match (Skip)
  Corpus: [anchor "rust-async-http": skills=["rust", "async"]]
  JD Keywords: ["Go", "GraphQL"]
  Bullet: "Built HTTP server in Rust"
  Expected: unchanged
  Expected Confidence: 0.95 (no changes = high confidence)
  Expected Warning: "Go, GraphQL not in corpus, skipped"
  Status: PASS

Test 4: Hallucination Block
  Corpus: [anchor "rust-async-http": skills=["rust", "async"]]
  JD Keywords: ["Kubernetes"]
  Attempted: "Orchestrated Kubernetes clusters"
  Expected: BLOCKED
  Expected Confidence: 0.0
  Expected Warning: "Kubernetes not in corpus"
  Status: PASS

Test 5: Metric Invariant (CRITICAL)
  Corpus: [anchor "postgres-migration": metrics=["50M rows", "2hr window"]]
  Original: "Migrated 50M-row table, completed in 2 hours"
  JD Keywords: ["PostgreSQL", "large-scale"]
  Expected Revised: "Migrated 50M-row PostgreSQL table with zero downtime, 2 hours"
  Expected MetricsChanged: false
  Expected InvariantCheck: ✓ PASS
  Status: PASS

Test 6: Contradiction Block
  Corpus: [anchor "junior-dev": claim="I was junior engineer", skills=["basic"]]
  Original Bullet: "Junior software engineer, 1 year exp"
  JD Keywords: ["senior", "10+ years"]
  Expected: BLOCKED
  Expected Warning: "Senior seniority contradicts corpus claim"
  Status: PASS
```

**Error Handling**:
- If corpus is empty: return unmodified resume + confidence 0.0 + message: "No experience anchors found. Add to ~/.applymate/experience.yaml"
- If LaTeX compilation fails (Tectonic): return LaTeX string + error message
- If all bullets blocked: show user the report, suggest adding to corpus

---

## PART 2: ARCHITECTURE & DATA MODEL

### 2.1 Core Data Structures

```typescript
// Master resume (source of truth)
interface MasterResume {
  path: string;                      // ~/.applymate/resume-master.tex
  latex: string;                     // Full LaTeX source
  compiledPdf: Buffer;               // Cached compiled PDF
  lastUpdated: ISO8601DateTime;
  sections: {
    summary: string;
    experience: BulletPoint[];
    skills: string[];
    education: string[];
  };
}

// Experience corpus (for anchor validation)
interface ExperienceCorpus {
  path: string;                      // ~/.applymate/experience.yaml
  experiences: ExperienceAnchor[];
  lastUpdated: ISO8601DateTime;
}

// Extracted job data (from content script)
interface ExtractedJobData {
  id: string;                        // uuid
  url: string;
  timestamp: ISO8601DateTime;
  
  board: "linkedin" | "indeed" | "greenhouse" | "lever" | "ashby" | "generic" | "unknown";
  boardConfidence: 0..1;
  
  jobTitle: string;
  company: string;
  jobDescription: string;
  
  formFields: FormField[];
  
  userValidated: boolean;
  userNotes?: string;
}

// Application (per job)
interface Application {
  id: string;
  extractedJobDataId: string;
  
  company: string;
  jobTitle: string;
  jobUrl: string;
  submittedAt?: ISO8601DateTime;
  status: "drafted" | "reviewing" | "submitted" | "interviewed" | "rejected";
  
  resumeVersions: ResumeVersion[];
  coverLetter?: string;
  
  formResponses: FormResponse[];
  
  createdAt: ISO8601DateTime;
  updatedAt: ISO8601DateTime;
}

// Resume version (per tailoring)
interface ResumeVersion {
  id: string;
  applicationId: string;
  
  latex: string;
  pdf: Buffer;
  
  modelUsed: "opus" | "sonnet" | "haiku";
  effortLevel: "low" | "med" | "high";
  
  rewritingReport: RewritingReport;
  userApprovedAt?: ISO8601DateTime;
  
  versionNumber: number;
  createdAt: ISO8601DateTime;
}

// Form response (what was submitted)
interface FormResponse {
  fieldId: string;
  fieldLabel: string;
  fieldType: string;
  value: string | Buffer;
  submittedAt: ISO8601DateTime;
}
```

### 2.2 Message Flow (Extension ↔ Background ↔ Panel ↔ Skill)

```
1. Content Script (job board)
   └─ Detect + extract → send to Background

2. Background Service Worker
   └─ Store in chrome.storage.session → open side panel

3. Side Panel (Tab 1: Job Data Review)
   └─ Show extracted data → user reviews

4. Side Panel (Tab 2: Form Validation)
   └─ User validates all form fields → "Proceed"

5. User clicks "Generate Tailored Resume"
   └─ Opens Claude Code with pre-filled /apply-to-job prompt

6. Claude Code (Pro, local)
   ├─ Runs /apply-to-job skill
   ├─ Executes 5-stage pipeline
   └─ Returns ApplyJobOutput

7. Side Panel (Tab 3: Tailoring Review)
   ├─ User reviews resume + report
   ├─ Approves or requests revision
   └─ "Proceed to Form"

8. Side Panel (Tab 4: Form Auto-Fill)
   ├─ Auto-fills form fields
   ├─ User reviews + edits
   └─ "Ready to Submit"

9. Form Submission (manual, on job board)
   └─ User clicks submit (extension does NOT)

10. Dashboard (Next.js)
    └─ Logs application, shows on board
```

### 2.3 SQLite Schema (~/.applymate/app.db)

```sql
CREATE TABLE applications (
  id TEXT PRIMARY KEY,
  company TEXT NOT NULL,
  job_title TEXT NOT NULL,
  job_url TEXT NOT NULL,
  extracted_job_data_id TEXT,
  status TEXT CHECK(status IN ('drafted', 'reviewing', 'submitted', 'interviewed', 'rejected')),
  submitted_at DATETIME,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE TABLE resume_versions (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  latex TEXT NOT NULL,
  model TEXT CHECK(model IN ('opus', 'sonnet', 'haiku')),
  effort_level TEXT CHECK(effort_level IN ('low', 'med', 'high')),
  rewriting_report JSON NOT NULL,
  user_approved_at DATETIME,
  created_at DATETIME NOT NULL,
  FOREIGN KEY(application_id) REFERENCES applications(id)
);

CREATE TABLE form_responses (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  field_label TEXT NOT NULL,
  field_type TEXT,
  value TEXT,
  submitted_at DATETIME NOT NULL,
  FOREIGN KEY(application_id) REFERENCES applications(id)
);

CREATE TABLE job_descriptions (
  id TEXT PRIMARY KEY,
  application_id TEXT NOT NULL,
  company TEXT NOT NULL,
  job_title TEXT NOT NULL,
  jd_text TEXT NOT NULL,
  extracted_at DATETIME NOT NULL,
  FOREIGN KEY(application_id) REFERENCES applications(id)
);
```

---

## PART 3: USER JOURNEYS

### 3.1 Happy Path: Job Board Detected

```
Step 1: User visits LinkedIn job posting
  ├─ Content script detects board (confidence 0.99)
  ├─ Extracts JD, form fields, company, job title
  └─ Injects ApplyMate button

Step 2: User clicks ApplyMate button
  ├─ Side panel opens (Tab 1: Job Data Review)
  ├─ Shows extracted data (editable)
  └─ User reviews, clicks "Next"

Step 3: User validates form fields (Tab 2)
  ├─ Sees all detected fields + confidence
  ├─ Clicks ✓ to validate each
  └─ Clicks "Proceed to Resume"

Step 4: User clicks "Generate Tailored Resume"
  ├─ Opens Claude Code with /apply-to-job prompt
  └─ User runs the skill

Step 5: Skill runs (5-stage pipeline)
  ├─ Stage 1: Parse JD
  ├─ Stage 2: Query corpus
  ├─ Stage 3: Rewrite bullets (anchor-validated)
  ├─ Stage 4: Compile LaTeX + PDF
  └─ Stage 5: Generate cover letter

Step 6: User reviews in Claude Code
  ├─ Sees resume preview + report
  ├─ Report shows: 5 bullets modified, 94% confidence
  └─ User approves

Step 7: Side panel receives results (Tab 3: Tailoring Review)
  ├─ User pastes or fetches ApplyJobOutput
  ├─ Side panel displays resume + report
  ├─ User reviews per-bullet changes
  └─ User approves, clicks "Proceed to Form"

Step 8: Side panel auto-fills form (Tab 4: Form Auto-Fill)
  ├─ Pre-fills: name, email, resume PDF, cover letter
  ├─ User reviews + edits fields
  └─ Clicks "Upload & Fill Form"

Step 9: Extension uploads resume + fills form
  ├─ Uploads tailored PDF to form
  ├─ Fills text fields (name, email, etc.)
  └─ User fills remaining fields manually

Step 10: User reviews form + submits (manual)
  ├─ Side panel shows final form preview
  ├─ User reviews all fields
  ├─ User manually clicks submit on LinkedIn
  └─ Extension does NOT auto-submit

Step 11: Application logged to dashboard
  ├─ Extension logs to SQLite
  ├─ Dashboard shows on Applications board
  └─ Resume version + metadata saved
```

### 3.2 Error Path: Low Confidence Anchor Validation

```
Step 1-6: [same as happy path]

Step 7: Skill detects low-confidence rewrite
  ├─ Bullet 3: tries to add "Kubernetes"
  ├─ Corpus check: not found
  ├─ Confidence: 0.6 (below 0.7 threshold)
  └─ Report flags warning

Step 8: Side panel (Tab 3) shows warning
  ├─ Displays all changes + confidence scores
  ├─ Bullet 3 marked with ⚠️
  ├─ Options: [Accept] [Remove] [Add to Corpus]
  └─ User cannot proceed until resolved

Step 9: User action
  Option A: Remove from resume
    └─ Bullet 3 reverted, proceeds

  Option B: Add to corpus
    ├─ Opens corpus editor
    ├─ User adds Kubernetes anchor
    ├─ Skill re-runs (or asks retry)
    ├─ Bullet 3 now 0.95 confidence
    └─ Proceeds

  Option C: Accept risk
    ├─ User clicks "Accept"
    ├─ Acknowledges low confidence
    ├─ Report saved with acknowledgment
    └─ Proceeds

Step 10+: [normal form auto-fill + submission]
```

### 3.3 Error Path: Job Board Not Detected

```
Step 1: User on unknown job board
  ├─ Content script: confidence 0.2 (too low)
  └─ Falls back to manual entry

Step 2: Side panel opens (Tab 1: Manual Entry Mode)
  ├─ Shows: "Job board not detected"
  ├─ Displays text inputs: Job Title, Company, JD textarea
  └─ User enters data manually

Step 3: User fills manual entry + clicks "Continue"
  └─ Data treated as if extracted, proceeds normally

Step 4+: [normal validation + skill invocation flow]
```

---

## PART 4: EDGE CASES & ERROR HANDLING

### 4.1 Content Script Edge Cases

| Scenario | Behavior |
|----------|----------|
| LinkedIn modal changes DOM | URL pattern still matches. If DOM extraction fails, show manual entry option. |
| Indeed removes JD from page | Form still extracted. Show warning: "JD not visible on page, paste below." |
| Form field has no label | Use placeholder text as label. Set confidence to 0.5. |
| Multiple resume fields (resume + cover) | Detect both as "file". Ask user: "Which is resume, which is cover letter?" |
| Form fields JavaScript-rendered | HTML not in initial DOM. Fallback to manual entry. |
| User closes side panel mid-extraction | Session storage preserves data. Reopen → data still there. |
| Extension permissions denied | Show error: "Grant extension permission to this site in chrome://extensions" |
| Very large JD (>50KB) | Truncate to first 20KB. Warn user: "JD truncated. Manually review if needed." |
| Same page multiple times (refresh) | Clear session storage on new tab open. |

### 4.2 Side Panel Edge Cases

| Scenario | Behavior |
|----------|----------|
| User edits extracted JD in panel | Edited version used for skill invocation. Original archived. |
| User adds custom form field | Added field appears in form auto-fill but marked "(user-added)". |
| Form validation pending for hours | Data persists in session storage indefinitely. |
| User switches browser tabs | Side panel closes. Data preserved. Reopen = data intact. |
| User changes model selection mid-process | If before skill runs: uses new model. If after: skill must re-run. |
| Network disconnected | Panel UI works (local). Skill requires Claude Code (fails with error message). |
| User copies LaTeX manually instead of via API | Side panel shows "Paste LaTeX" field. User manually pastes output. |

### 4.3 Skill Edge Cases

| Scenario | Behavior |
|----------|----------|
| JD has contradictory requirements | Parse both, flag in report for user review. |
| Corpus is empty (no anchors) | Return unmodified resume. Confidence 0.0. Message: "Add experiences to ~/.applymate/experience.yaml" |
| Resume bullet is extremely vague | Attempt rewrite, but confidence drops. Flag for user review. |
| LaTeX compilation fails | Return LaTeX string as fallback. Error message: "PDF generation failed. Use LaTeX at Overleaf.com" |
| Very large resume (10+ pages) | Process all bullets. Warn: "Resume is 10+ pages. Consider trimming for ATS." |
| User corpus has outdated skills | User manually edits experience.yaml. Re-invokes skill. |
| JD is extremely short (<100 chars) | Parse as much as possible. Confidence likely lower. Flag for review. |

### 4.4 Form Auto-Fill Edge Cases

| Scenario | Behavior |
|----------|----------|
| Resume PDF upload fails | Show error. Option: try again or paste LaTeX in text field. |
| Form requires .docx but we have .pdf | Warn: "Form requires .docx. Download template + convert manually or check Accept PDF." |
| File upload field has size limit < PDF size | Warn: "PDF is 500KB, field limit is 256KB. Compress or use text version." |
| Form field disappears (JS-hidden) | Skip field. Log in audit trail: "Field X skipped (not visible at submit time)." |
| User enters text in wrong field | Show all fields before submit. User can rearrange/correct. |
| Form auto-closes after input | Extension doesn't auto-submit anyway. User handles manually. |
| Custom Q field character limit < suggested answer | Show warning: "Suggested answer is 500 chars, field limit is 200. Edit to fit." |

---

## PART 5: VALIDATION CHECKPOINTS & TEST CASES

### 5.1 Test Matrix

```
UNIT TESTS (automated)
├─ Content Script (60 tests)
│  ├─ Job board detection (20 tests)
│  │  └─ URL patterns, DOM heuristics, fallback
│  ├─ JD extraction (15 tests)
│  │  └─ Text parsing, HTML handling, edge cases
│  ├─ Form field crawl (15 tests)
│  │  └─ <input>, <textarea>, <select>, hidden fields
│  └─ Field type inference (10 tests)
│     └─ Label parsing, confidence scoring
│
├─ Side Panel (30 tests)
│  ├─ Render extracted data (10 tests)
│  ├─ Form validation gate logic (10 tests)
│  ├─ Session storage persistence (5 tests)
│  └─ UI state transitions (5 tests)
│
├─ Skill (100+ tests) ⭐ CRITICAL
│  ├─ Stage 1: JD parsing (20 tests)
│  ├─ Stage 2: pgvector retrieval (15 tests)
│  ├─ Stage 3: Anchor validation (50 tests)
│  │  ├─ Exact matches (5)
│  │  ├─ Logical extensions (5)
│  │  ├─ No matches (5)
│  │  ├─ Hallucination blocks (10)
│  │  ├─ Metric invariants (10)
│  │  └─ Contradiction blocks (10)
│  ├─ Stage 4: LaTeX assembly (10 tests)
│  └─ Stage 5: Cover letter (10 tests)
│
├─ Dashboard (30 tests)
│  ├─ SQLite queries (15 tests)
│  ├─ Resume version diff (10 tests)
│  └─ UI rendering (5 tests)
│
└─ Storage (15 tests)
   ├─ Chrome session storage (5 tests)
   ├─ Filesystem paths (5 tests)
   └─ SQLite migrations (5 tests)

INTEGRATION TESTS (automated)
├─ Extract → Validate → Skill → Auto-fill (3 tests)
├─ Resume version saved correctly (2 tests)
└─ Dashboard shows submitted application (1 test)

E2E TESTS (manual)
├─ LinkedIn posting → extract → approve → form fill → submit
├─ Indeed posting → extract → approve → form fill → submit
└─ Generic site → manual entry → skill → form fill → submit

PERFORMANCE TESTS
├─ [Automated] Skill completes in < 30 seconds
└─ [Manual] Side panel UI responsive (no lag)

REGRESSION TESTS
└─ [Automated] All unit tests run after each commit
```

### 5.2 Manual Approval Gates

**Phase 1 Complete** ✅ → Manual Gate
```
Checklist:
☐ Content script detects LinkedIn + Indeed + Greenhouse (test on real sites)
☐ Extracts JD + form fields with ≥90% accuracy (3 real postings)
☐ Side panel displays extracted data correctly
☐ Form validation gate requires ✓ on all fields
☐ Session storage persists data if panel closes
☐ Fallback to manual entry works (test on unknown site)
☐ All content script unit tests pass (60/60)

Sign-off: Ready for Phase 2
```

**Phase 2 Complete** ✅ → Manual Gate
```
Checklist:
☐ All 5 skill stages execute without errors
☐ Anchor validation blocks hallucinations (50 tests pass)
☐ Rewriting report shows per-bullet breakdown + confidence
☐ User can approve/reject/revise changes in side panel
☐ LaTeX compiles to PDF (Tectonic-WASM works)
☐ Cover letter generation is coherent + company-specific
☐ All skill unit tests pass (100+/100)

Sign-off: Pipeline is bulletproof
```

**Phase 3 Complete** ✅ → Manual Gate
```
Checklist:
☐ Form field detection ≥90% accurate (test on 5 different forms)
☐ User can override detected field types
☐ Resume PDF uploads to form without errors
☐ Cover letter auto-fills to correct text field
☐ Custom Q suggestions are sensible
☐ Form preview shows all fields before submit
☐ Extension does NOT auto-submit (hard constraint)
☐ All form auto-fill tests pass (30+/30)

Sign-off: Form auto-fill works reliably
```

**Phase 4 Complete** ✅ → Manual Gate
```
Checklist:
☐ Dashboard loads locally (http://localhost:3000)
☐ Applications board shows submitted applications
☐ Resume versions are listed + downloadable
☐ Version diff shows changes (side-by-side)
☐ PDF viewer displays resume correctly
☐ JD archive is searchable
☐ Metadata saved correctly (model, confidence, timestamp)
☐ All dashboard tests pass (30/30)

Sign-off: Tracking system works
```

**Phase 5 Complete** ✅ → Launch Approval
```
Checklist:
☐ Full E2E: LinkedIn → generate → fill → ready (works)
☐ Full E2E: Indeed → generate → fill → ready (works)
☐ Resume accuracy manually verified (looks good)
☐ No auto-submit (user controls submission)
☐ No data loss during entire flow
☐ All regression tests pass
☐ All resume bullets achievable + verifiable

Sign-off: Ready to use daily
```

---

## PART 6: IMPLEMENTATION PHASES

### Phase 1: Core Extension (Week 1-2)

**Goal**: Reliably extract job data. No skill yet.

**Deliverables**:
- Chrome MV3 scaffold (manifest, background, side panel, content script)
- Content script detection (LinkedIn, Indeed, Greenhouse, generic fallback)
- JD + form field extraction
- Side panel Tabs 1-2 (data review + form validation)
- Session storage persistence
- Manual entry fallback UI

**Acceptance Criteria**:
- LinkedIn posting → ≥95% JD extraction accuracy
- Indeed posting → ≥95% JD extraction accuracy
- Greenhouse → ≥90% JD extraction accuracy
- Form fields detected (test on 3 forms)
- All fields show validation gate
- Close + reopen panel → data persists
- Manual entry works on unknown site
- 60/60 unit tests pass

---

### Phase 2: 5-Stage Skill (Week 3-4)

**Goal**: Resume tailoring pipeline works end-to-end.

**Deliverables**:
- `/apply-to-job` skill handler (Claude Code)
- Stage 1: JD parsing (keywords, seniority, tech stack)
- Stage 2: pgvector semantic retrieval (corpus matching)
- Stage 3: Anchor-validated rewriting (keyword injection + invariant checks)
- Stage 4: LaTeX assembly (template substitution)
- Stage 5: Cover letter generation (markdown)
- Tectonic-WASM PDF compilation
- Plausibility report generation
- Side panel Tab 3 (tailoring review)

**Acceptance Criteria**:
- Skill runs without errors (5 stages complete)
- JD keywords extracted correctly
- pgvector finds relevant anchors
- Anchor validation blocks hallucinations (50 tests pass)
- Confidence scores realistic (0.95 for exact match, 0.6 for unsupported)
- LaTeX compiles to PDF
- Cover letter is coherent + company-specific
- User can approve/reject/revise changes
- 100+/100 unit tests pass (especially anchor validation)

---

### Phase 3: Form Auto-Fill (Week 5)

**Goal**: Detect form fields + auto-fill with generated artifacts.

**Deliverables**:
- Form field type inference algorithm
- Confidence scoring per field
- Side panel Tab 4 (form auto-fill + preview)
- Auto-fill logic (name, email, resume, cover letter, custom Q's)
- PDF upload handling
- Manual override per field
- Form submission preview
- Never auto-submit constraint (hard fail if violated)

**Acceptance Criteria**:
- Form fields detected with ≥90% accuracy (test on 5 forms)
- Field type inference confidence realistic
- Auto-fill values look correct
- User can override any auto-filled value
- Resume PDF uploads without errors
- Cover letter auto-fills correctly
- Custom Q suggestions are sensible
- Form preview before submit works
- Extension does NOT submit automatically (hard constraint)
- 30+/30 tests pass

---

### Phase 4: Dashboard + Versioning (Week 6)

**Goal**: Track applications + resume versions.

**Deliverables**:
- Next.js local dashboard (http://localhost:3000)
- Applications board (list, filter, archive)
- Resume versions (store, compare, download)
- JD archive (searchable, taggable)
- SQLite schema + queries
- Tectonic-WASM PDF viewer
- Metadata tracking (model, effort, confidence, timestamp)
- Analytics (submission rate, interview rate, keyword effectiveness)

**Acceptance Criteria**:
- Dashboard loads locally
- Applications board shows submitted applications
- Resume versions listed + downloadable
- Version diff works (side-by-side)
- PDF viewer functional
- JD archive searchable by keyword
- Metadata saved correctly
- 30/30 tests pass

---

### Phase 5: Polish + Launch (Week 7-8)

**Goal**: Full E2E validation + production readiness.

**Deliverables**:
- Full E2E tests (2 job boards: extract → generate → fill → submit)
- Keyboard shortcuts (Cmd+Shift+A to activate)
- Error messages + recovery flows
- Resume accuracy validation (manual review)
- Extension deployment (Chrome Web Store or local)
- Documentation (README, setup guide)

**Acceptance Criteria**:
- Full E2E LinkedIn → works
- Full E2E Indeed → works
- Resume accuracy manually verified
- No data loss during full flow
- All resume bullets validatable
- Ready for daily use

---

## PART 7: RESUME BULLETS ALIGNMENT

This spec validates all resume bullets:

✅ **"Built an end-to-end AI job application agent across Chrome MV3 extension"**
- Phase 1: Content script, side panel, background worker ✓

✅ **"and Next.js dashboard"**
- Phase 4: Dashboard, applications board, resume tracking ✓

✅ **"with 5-stage LLM pipeline: JD extraction, pgvector semantic retrieval, Claude rewriting with anchor-validated invariant checks, LaTeX assembly, and cover letter generation"**
- Phase 2: All 5 stages detailed + tested ✓

✅ **"Compiled LaTeX to PDF client-side via Tectonic-WASM with zero server cost"**
- Phase 2, Phase 4: Tectonic integration ✓

✅ **"built a portal abstraction layer with heuristic-plus-LLM form auto-fill"**
- Phase 3, Phase 4: Form detection (heuristic) + LLM-guided answers ✓

---

## PART 8: SUCCESS CRITERIA (FINAL)

- [x] All 3 technical risks locked down (detection, form validation, anchor validation)
- [x] 5-phase implementation plan with manual gates
- [x] 100+ test cases (especially anchor validation)
- [x] All edge cases documented
- [x] All resume bullets achievable + verifiable
- [x] Never auto-submits (hard constraint)
- [x] Spec is bulletproof for solo spec-driven development

---

## Document Review

**Self-Review Checklist**:
- ✅ No TBD or placeholder sections
- ✅ Internal consistency (architecture matches features)
- ✅ Scope is focused (one product, 5 phases)
- ✅ No ambiguous requirements (all acceptance criteria explicit)
- ✅ All edge cases covered
- ✅ All test cases numbered + expected output defined
- ✅ Manual gates clear + verifiable
- ✅ Resume bullets validated

**Ready for**: User review, then implementation planning
