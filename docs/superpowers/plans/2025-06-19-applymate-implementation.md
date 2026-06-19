# ApplyMate Implementation Plan

> **For agentic workers:** RECOMMENDED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build end-to-end AI job application agent (Chrome extension + skill + dashboard) with 5-stage resume tailoring pipeline, spec-driven development, TDD, frequent commits.

**Architecture:** 
- Phase 1: Chrome MV3 extension with content script (job board detection + extraction), side panel (data review + form validation), background worker (messaging).
- Phase 2: Claude Code skill (`/apply-to-job`) implementing 5-stage pipeline (JD parsing → pgvector retrieval → anchor-validated rewriting → LaTeX assembly → cover letter).
- Phase 3: Form auto-fill detection + field matching + PDF upload handling.
- Phase 4: Next.js local dashboard (SQLite storage, application tracking, resume versioning).
- Phase 5: E2E testing + polish.

**Tech Stack:** Chrome MV3, TypeScript, React (side panel), Vite (extension build), Claude Code Pro (local), Next.js (dashboard), SQLite (local DB), Tectonic-WASM (PDF compilation), pgvector (semantic retrieval).

## Global Constraints

- Never auto-submit form (hard constraint). User must manually click submit button on job board.
- No Claude API calls (use Pro plan locally only).
- Anchor validation: all keyword injections backed by experience corpus, zero hallucinations.
- All forms/fields validated by user before auto-fill.
- 100+ unit tests (especially anchor validation: 50+ tests).
- Manual approval gates before each phase advances.
- Commits after every task (TDD: test → implement → commit).

---

## FILE STRUCTURE

### Root Level
```
ApplyMate/
├── .env.example
├── .gitignore
├── package.json                    # Root package (monorepo config)
├── pnpm-workspace.yaml             # Monorepo workspace
├── README.md
├── CLAUDE.md
│
├── docs/
│   └── superpowers/
│       ├── specs/
│       │   └── 2025-06-19-applymate-design.md
│       └── plans/
│           └── 2025-06-19-applymate-implementation.md (this file)
│
├── packages/
│   ├── extension/
│   ├── skill/
│   └── dashboard/
│
├── lib/
│   ├── shared/
│   └── local/
│
└── tests/
    ├── extension/
    ├── skill/
    └── e2e/
```

### Extension Package
```
packages/extension/
├── src/
│   ├── content/
│   │   ├── content.ts              # Main content script entry
│   │   ├── detectors/
│   │   │   ├── index.ts
│   │   │   ├── linkedin.ts
│   │   │   ├── indeed.ts
│   │   │   ├── greenhouse.ts
│   │   │   └── generic.ts
│   │   └── extractors/
│   │       ├── index.ts
│   │       ├── jd.ts
│   │       └── form.ts
│   ├── ui/
│   │   ├── side-panel.tsx
│   │   ├── components/
│   │   │   ├── JobDataReview.tsx
│   │   │   ├── FormValidation.tsx
│   │   │   ├── TailoringReview.tsx
│   │   │   └── FormAutoFill.tsx
│   │   └── styles/
│   │       └── tailwind.css
│   ├── background.ts
│   ├── types.ts
│   └── utils/
│       ├── storage.ts
│       ├── messaging.ts
│       └── clipboard.ts
├── public/
│   └── icon.png
├── manifest.json
├── vite.config.ts
├── package.json
└── tsconfig.json
```

### Skill Package
```
packages/skill/
├── apply-to-job.ts                 # Main skill handler
├── stages/
│   ├── 1-parse-jd.ts               # Stage 1: JD keyword extraction
│   ├── 2-retrieve.ts               # Stage 2: pgvector semantic retrieval
│   ├── 3-rewrite.ts                # Stage 3: Anchor-validated rewriting
│   ├── 4-latex.ts                  # Stage 4: LaTeX assembly + compilation
│   └── 5-cover-letter.ts           # Stage 5: Cover letter generation
├── validators/
│   ├── invariant-checks.ts         # Metric preservation, no hallucinations
│   └── plausibility.ts             # Confidence scoring
├── types.ts                         # Shared types for skill
└── index.ts                         # Export handler
```

### Dashboard Package
```
packages/dashboard/
├── app/
│   ├── applications/
│   │   ├── page.tsx                # Applications board
│   │   └── [id]/
│   │       └── page.tsx            # Application detail
│   ├── resumes/
│   │   ├── page.tsx                # Resume versions list
│   │   └── [id]/
│   │       └── page.tsx            # Version detail + diff
│   ├── jd-archive/
│   │   └── page.tsx                # JD search + filter
│   ├── analytics/
│   │   └── page.tsx                # Submit/interview rates
│   ├── layout.tsx
│   └── page.tsx                    # Dashboard home
├── lib/
│   ├── db.ts                       # SQLite queries
│   ├── tectonic.ts                 # Tectonic-WASM wrapper
│   └── diff.ts                     # Resume version diffing
├── package.json
└── tsconfig.json
```

### Shared Libraries
```
lib/
├── shared/
│   ├── types.ts                    # Cross-package types
│   └── constants.ts                # Board detection patterns, field mappings
└── local/
    ├── experience-store.ts         # Load + query ~/.applymate/experience.yaml
    ├── resume-loader.ts            # Load master resume LaTeX
    └── pgvector.ts                 # Vector DB setup (if using local postgres)
```

### Tests
```
tests/
├── extension/
│   ├── detectors.test.ts           # 20 tests: URL pattern, DOM heuristics
│   ├── extractors.test.ts          # 15 tests: JD + form field parsing
│   └── messaging.test.ts           # 10 tests: content ↔ background messaging
├── skill/
│   ├── stages.test.ts              # 50 tests: all 5 stages
│   ├── anchor-validation.test.ts   # 50+ tests: keyword injection, invariant checks
│   └── plausibility.test.ts        # 20 tests: confidence scoring
└── e2e/
    └── full-flow.test.ts           # 3 tests: extract → generate → fill → submit
```

---

## PHASE 1: CORE EXTENSION (Week 1-2)

**Goal**: Reliable job data extraction. No skill yet. User validates all data before proceeding.

**Manual Gate Before Phase 2:**
- [ ] LinkedIn posting → ≥95% JD extraction accuracy (test on 1 real posting)
- [ ] Indeed posting → ≥95% JD extraction accuracy (test on 1 real posting)
- [ ] Greenhouse career site → ≥90% JD extraction accuracy (test on 1 real posting)
- [ ] Generic site → fallback to manual entry works
- [ ] Form fields detected (test on 2 forms)
- [ ] All form fields require user ✓ validation before proceeding
- [ ] Close + reopen panel → data persists in session storage
- [ ] 60/60 unit tests pass

---

### Task 1.1: Project Setup & Monorepo Structure

**Files:**
- Create: `package.json` (root)
- Create: `pnpm-workspace.yaml`
- Create: `packages/extension/package.json`
- Create: `packages/extension/tsconfig.json`
- Create: `packages/extension/vite.config.ts`
- Create: `.env.example`
- Create: `.gitignore`

**Interfaces:**
- Consumes: (none)
- Produces: Working monorepo build system

---

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "applymate",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "install": "pnpm install",
    "dev:extension": "pnpm --filter extension dev",
    "build:extension": "pnpm --filter extension build",
    "dev:dashboard": "pnpm --filter dashboard dev",
    "build:dashboard": "pnpm --filter dashboard build",
    "test": "pnpm --filter extension test && pnpm --filter skill test && pnpm --filter dashboard test",
    "test:extension": "pnpm --filter extension test",
    "test:skill": "pnpm --filter skill test",
    "test:e2e": "pnpm --filter e2e test",
    "type-check": "pnpm --filter extension type-check && pnpm --filter skill type-check && pnpm --filter dashboard type-check",
    "lint": "pnpm --filter extension lint && pnpm --filter skill lint && pnpm --filter dashboard lint"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}
```

- [ ] **Step 2: Create pnpm-workspace.yaml**

```yaml
packages:
  - 'packages/*'
  - 'lib/*'
```

- [ ] **Step 3: Create packages/extension/package.json**

```json
{
  "name": "@applymate/extension",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "type-check": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.230",
    "@types/node": "^20.0.0",
    "@types/react": "^18.2.0",
    "typescript": "^5.0.0",
    "vite": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

- [ ] **Step 4: Create packages/extension/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "resolveJsonModule": true,
    "jsx": "react-jsx"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 5: Create packages/extension/vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        content: path.resolve(__dirname, 'src/content/content.ts'),
        background: path.resolve(__dirname, 'src/background.ts'),
        'side-panel': path.resolve(__dirname, 'src/ui/side-panel.tsx'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name]-chunk.js',
      },
    },
  },
});
```

- [ ] **Step 6: Create .env.example**

```
CLAUDE_CODE_PORT=3000
CLAUDE_CODE_MODEL=opus-4-8
CLAUDE_CODE_EFFORT=high
RESUME_MASTER_PATH=~/.applymate/resume-master.tex
EXPERIENCE_CORPUS_PATH=~/.applymate/experience.yaml
SQLITE_PATH=~/.applymate/app.db
```

- [ ] **Step 7: Create .gitignore**

```
node_modules/
.env.local
.DS_Store
dist/
build/
*.log
.vscode/
.idea/
~/.applymate/applications/
~/.applymate/*.pdf
```

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-workspace.yaml packages/extension/ .env.example .gitignore
git commit -m "chore: scaffold monorepo structure with extension package"
```

---

### Task 1.2: Shared Types & Constants

**Files:**
- Create: `lib/shared/types.ts`
- Create: `lib/shared/constants.ts`
- Create: `packages/extension/src/types.ts`

**Interfaces:**
- Consumes: (none)
- Produces: `ExtractedJobData`, `FormField`, `DetectionResult`, board detection patterns

---

- [ ] **Step 1: Create lib/shared/types.ts**

```typescript
export interface FormField {
  id: string;
  label: string;
  type: "text" | "email" | "tel" | "textarea" | "select" | "file" | "checkbox" | "radio" | "unknown";
  placeholder?: string;
  required: boolean;
  extractedValueType?: "name" | "email" | "phone" | "resume" | "cover-letter" | "custom-q" | null;
  matchConfidence: number;
  userSelectedValueType?: string;
  userProvidedValue?: string;
  validated: boolean;
}

export interface DetectionResult {
  board: "linkedin" | "indeed" | "greenhouse" | "lever" | "ashby" | "generic" | "unknown";
  confidence: number;
  method: "url_pattern" | "dom_structure" | "fallback";
  detectedElements: {
    jdContainer?: string;
    formContainer?: string;
    companyElement?: string;
    jobTitleElement?: string;
  };
}

export interface ExtractedJobData {
  id: string;
  url: string;
  timestamp: string;
  board: string;
  boardConfidence: number;
  jobTitle: string;
  company: string;
  jobDescription: string;
  formFields: FormField[];
  userValidated: boolean;
  userNotes?: string;
}
```

- [ ] **Step 2: Create lib/shared/constants.ts**

```typescript
export const BOARD_DETECTION_PATTERNS = {
  linkedin: {
    urlPattern: /linkedin\.com\/jobs\/view\//,
    domSelectors: [".posting-description", "[data-job-id]"],
    confidence: 0.99,
  },
  indeed: {
    urlPattern: /indeed\.com\/jobs\?/,
    domSelectors: [".jobsearch-JobComponent", "[data-testid='jobsearch-Result']"],
    confidence: 0.99,
  },
  greenhouse: {
    urlPattern: /\.greenhouse\.io/,
    domSelectors: [".app-body", "[data-department-id]"],
    confidence: 0.95,
  },
  lever: {
    urlPattern: /\.lever\.co/,
    domSelectors: [".posting", "[data-posting-id]"],
    confidence: 0.95,
  },
  ashby: {
    urlPattern: /\.ashby\.com/,
    domSelectors: [".job-posting", "[data-job-id]"],
    confidence: 0.95,
  },
};

export const FIELD_TYPE_KEYWORDS = {
  name: ["name", "full name", "your name", "applicant name"],
  email: ["email", "email address"],
  phone: ["phone", "phone number", "contact"],
  resume: ["resume", "cv", "curriculum vitae"],
  "cover-letter": ["cover letter", "cover", "cover letter"],
  "custom-q": ["why", "interested", "interest", "experience", "tell us"],
};

export const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.85,
  MEDIUM: 0.7,
  LOW: 0.5,
  FALLBACK: 0.3,
};
```

- [ ] **Step 3: Create packages/extension/src/types.ts**

```typescript
export type { ExtractedJobData, FormField, DetectionResult } from "../../../lib/shared/types";

export interface MessageFromContent {
  type: "JOB_EXTRACTED" | "ERROR";
  data?: any;
  error?: string;
}

export interface MessageFromBackground {
  type: "OPEN_CLAUDE_CODE" | "APPLY_JOB_OUTPUT_RECEIVED";
  data?: any;
}

export interface SidePanelState {
  extractedJobData?: ExtractedJobData;
  currentTab: "data-review" | "form-validation" | "tailoring-review" | "form-auto-fill";
  isLoading: boolean;
}
```

- [ ] **Step 4: Commit**

```bash
git add lib/shared/types.ts lib/shared/constants.ts packages/extension/src/types.ts
git commit -m "feat: add shared types and detection patterns"
```

---

### Task 1.3: Chrome Manifest & Scaffold

**Files:**
- Create: `packages/extension/manifest.json`
- Create: `packages/extension/public/icon.png` (placeholder)
- Create: `packages/extension/src/content/content.ts` (stub)
- Create: `packages/extension/src/background.ts` (stub)
- Create: `packages/extension/src/ui/side-panel.tsx` (stub)

**Interfaces:**
- Consumes: Manifest V3 spec
- Produces: Valid Chrome extension structure

---

- [ ] **Step 1: Create packages/extension/manifest.json**

```json
{
  "manifest_version": 3,
  "name": "ApplyMate",
  "version": "1.0.0",
  "description": "AI-powered job application automation",
  "permissions": [
    "activeTab",
    "scripting",
    "sidePanel",
    "storage"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "background": {
    "service_worker": "dist/background.js",
    "type": "module"
  },
  "action": {
    "default_icon": "icon.png",
    "default_title": "ApplyMate: Auto-fill job applications"
  },
  "side_panel": {
    "default_path": "side-panel.html"
  },
  "icons": {
    "16": "icon.png",
    "48": "icon.png",
    "128": "icon.png"
  }
}
```

- [ ] **Step 2: Create packages/extension/public/icon.png (placeholder)**

```bash
cd packages/extension/public
# Create 128x128 PNG placeholder (use ImageMagick or download)
# For now: touch icon.png (will be 0 bytes, but structure is there)
touch icon.png
```

- [ ] **Step 3: Create packages/extension/src/content/content.ts (stub)**

```typescript
console.log("[ApplyMate] Content script loaded on:", window.location.href);

// TODO: Implement job board detection + extraction
```

- [ ] **Step 4: Create packages/extension/src/background.ts (stub)**

```typescript
console.log("[ApplyMate] Background service worker started");

// TODO: Implement message routing + session storage
```

- [ ] **Step 5: Create packages/extension/src/ui/side-panel.tsx (stub)**

```typescript
import React from "react";
import ReactDOM from "react-dom/client";

function App() {
  return <div>ApplyMate - Side Panel</div>;
}

ReactDOM.createRoot(document.getElementById("app") || document.body).render(
  <App />
);
```

- [ ] **Step 6: Create side-panel.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ApplyMate</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="dist/side-panel.js"></script>
</body>
</html>
```

- [ ] **Step 7: Verify build (should compile without errors)**

```bash
cd packages/extension
npm install @vitejs/plugin-react
npm run build
# Expected: dist/ directory created with JS files
```

- [ ] **Step 8: Commit**

```bash
git add packages/extension/manifest.json packages/extension/public/ packages/extension/src/content/content.ts packages/extension/src/background.ts packages/extension/src/ui/side-panel.tsx
git commit -m "chore: scaffold Chrome extension with manifest and stubs"
```

---

### Task 1.4: Job Board Detection (LinkedIn + Indeed)

**Files:**
- Create: `packages/extension/src/content/detectors/index.ts`
- Create: `packages/extension/src/content/detectors/linkedin.ts`
- Create: `packages/extension/src/content/detectors/indeed.ts`
- Create: `packages/extension/src/content/detectors/generic.ts`
- Create: `tests/extension/detectors.test.ts`

**Interfaces:**
- Consumes: `BOARD_DETECTION_PATTERNS`, `DetectionResult`
- Produces: `detect()` function returning `DetectionResult`

---

- [ ] **Step 1: Write failing test for LinkedIn URL pattern**

```typescript
// tests/extension/detectors.test.ts
import { describe, it, expect } from "vitest";
import { detect } from "../../packages/extension/src/content/detectors/index";

describe("Board Detection", () => {
  it("should detect LinkedIn from URL pattern", () => {
    const result = detect({
      url: "https://www.linkedin.com/jobs/view/1234567890/",
      html: "",
    });

    expect(result.board).toBe("linkedin");
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    expect(result.method).toBe("url_pattern");
  });

  it("should detect Indeed from URL pattern", () => {
    const result = detect({
      url: "https://www.indeed.com/jobs?q=software",
      html: "",
    });

    expect(result.board).toBe("indeed");
    expect(result.confidence).toBeGreaterThanOrEqual(0.95);
    expect(result.method).toBe("url_pattern");
  });

  it("should fallback to generic for unknown URL", () => {
    const result = detect({
      url: "https://unknown-careers.com/jobs/123",
      html: "<textarea></textarea><input /><input /><p>Job description text...</p>",
    });

    expect(result.board).toBe("generic");
    expect(result.confidence).toBeLessThan(0.7);
    expect(result.method).toBe("fallback");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/extension
npm run test
# Expected: FAIL - "Cannot find module or its corresponding type definitions"
```

- [ ] **Step 3: Create packages/extension/src/content/detectors/index.ts**

```typescript
import { DetectionResult } from "../../../../lib/shared/types";
import { detectLinkedIn } from "./linkedin";
import { detectIndeed } from "./indeed";
import { detectGeneric } from "./generic";

export interface DetectionInput {
  url: string;
  html: string;
}

export function detect(input: DetectionInput): DetectionResult {
  // Try URL pattern first
  let result = detectLinkedIn(input);
  if (result.confidence > 0.7) return result;

  result = detectIndeed(input);
  if (result.confidence > 0.7) return result;

  // Fallback to generic
  return detectGeneric(input);
}
```

- [ ] **Step 4: Create packages/extension/src/content/detectors/linkedin.ts**

```typescript
import { BOARD_DETECTION_PATTERNS } from "../../../../lib/shared/constants";
import { DetectionResult } from "../../../../lib/shared/types";
import { DetectionInput } from "./index";

export function detectLinkedIn(input: DetectionInput): DetectionResult {
  const pattern = BOARD_DETECTION_PATTERNS.linkedin;

  if (pattern.urlPattern.test(input.url)) {
    return {
      board: "linkedin",
      confidence: 0.99,
      method: "url_pattern",
      detectedElements: {},
    };
  }

  // DOM fallback
  for (const selector of pattern.domSelectors) {
    if (input.html.includes(selector)) {
      return {
        board: "linkedin",
        confidence: 0.8,
        method: "dom_structure",
        detectedElements: { jdContainer: selector },
      };
    }
  }

  return {
    board: "unknown",
    confidence: 0,
    method: "fallback",
    detectedElements: {},
  };
}
```

- [ ] **Step 5: Create packages/extension/src/content/detectors/indeed.ts**

```typescript
import { BOARD_DETECTION_PATTERNS } from "../../../../lib/shared/constants";
import { DetectionResult } from "../../../../lib/shared/types";
import { DetectionInput } from "./index";

export function detectIndeed(input: DetectionInput): DetectionResult {
  const pattern = BOARD_DETECTION_PATTERNS.indeed;

  if (pattern.urlPattern.test(input.url)) {
    return {
      board: "indeed",
      confidence: 0.99,
      method: "url_pattern",
      detectedElements: {},
    };
  }

  for (const selector of pattern.domSelectors) {
    if (input.html.includes(selector)) {
      return {
        board: "indeed",
        confidence: 0.8,
        method: "dom_structure",
        detectedElements: { jdContainer: selector },
      };
    }
  }

  return {
    board: "unknown",
    confidence: 0,
    method: "fallback",
    detectedElements: {},
  };
}
```

- [ ] **Step 6: Create packages/extension/src/content/detectors/generic.ts**

```typescript
import { DetectionResult } from "../../../../lib/shared/types";
import { DetectionInput } from "./index";

export function detectGeneric(input: DetectionInput): DetectionResult {
  // Count textareas + inputs
  const textareaCount = (input.html.match(/<textarea/g) || []).length;
  const inputCount = (input.html.match(/<input/g) || []).length;
  const totalFormElements = textareaCount + inputCount;

  // Check for substantial text (JD indicator)
  const hasLargeTextContent = input.html.length > 500;

  if (totalFormElements >= 3 && hasLargeTextContent) {
    return {
      board: "generic",
      confidence: 0.3,
      method: "fallback",
      detectedElements: {
        formContainer: "form (generic)",
      },
    };
  }

  return {
    board: "unknown",
    confidence: 0.0,
    method: "fallback",
    detectedElements: {},
  };
}
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd packages/extension
npm run test
# Expected: PASS - All 3 tests pass
```

- [ ] **Step 8: Commit**

```bash
git add packages/extension/src/content/detectors/ tests/extension/detectors.test.ts
git commit -m "feat: implement job board detection (LinkedIn, Indeed, generic)"
```

---

### Task 1.5: Job Description Extraction

**Files:**
- Create: `packages/extension/src/content/extractors/index.ts`
- Create: `packages/extension/src/content/extractors/jd.ts`
- Create: `tests/extension/extractors.test.ts`

**Interfaces:**
- Consumes: DOM HTML, board type
- Produces: `{ jobDescription: string, jobTitle: string, company: string }`

---

- [ ] **Step 1: Write failing test for JD extraction**

```typescript
// tests/extension/extractors.test.ts
import { describe, it, expect } from "vitest";
import { extractJD } from "../../packages/extension/src/content/extractors/index";

describe("JD Extraction", () => {
  it("should extract job description text from generic page", () => {
    const html = `
      <h1>Senior Rust Engineer</h1>
      <p>Company: Acme Corp</p>
      <div class="job-posting">
        We are looking for a Senior Rust Engineer with 5+ years of experience.
        Required skills: Rust, async/await, systems programming.
      </div>
    `;

    const result = extractJD(html, "generic");

    expect(result.jobDescription).toContain("Senior Rust Engineer");
    expect(result.jobDescription.length).toBeGreaterThan(50);
  });

  it("should extract job title from heading", () => {
    const html = `
      <h1>Senior Rust Engineer</h1>
      <p>Company: Acme Corp</p>
      <div class="job-posting">Job details...</div>
    `;

    const result = extractJD(html, "generic");

    expect(result.jobTitle).toContain("Senior Rust Engineer");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/extension
npm run test -- extractors
# Expected: FAIL - "Cannot find module"
```

- [ ] **Step 3: Create packages/extension/src/content/extractors/index.ts**

```typescript
import { extractJD as extractJDFromGeneric } from "./jd";

export interface ExtractedContent {
  jobDescription: string;
  jobTitle: string;
  company: string;
}

export function extractJD(html: string, board: string): ExtractedContent {
  if (board === "generic" || board === "unknown") {
    return extractJDFromGeneric(html);
  }

  // TODO: Board-specific extractors
  return {
    jobDescription: extractTextContent(html),
    jobTitle: extractHeading(html),
    company: extractCompany(html),
  };
}

function extractTextContent(html: string): string {
  // Remove script/style
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");

  // Strip HTML tags
  text = text.replace(/<[^>]*>/g, " ");

  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text.substring(0, 5000); // Limit to 5000 chars
}

function extractHeading(html: string): string {
  const headingMatch = html.match(/<h[1-3][^>]*>([^<]+)<\/h[1-3]>/);
  return headingMatch ? headingMatch[1].trim() : "Job Title (Not Found)";
}

function extractCompany(html: string): string {
  const companyMatch = html.match(/[Cc]ompany[\s:]*([^<\n]+)/);
  return companyMatch ? companyMatch[1].trim() : "Company (Not Found)";
}
```

- [ ] **Step 4: Create packages/extension/src/content/extractors/jd.ts**

```typescript
import { ExtractedContent } from "./index";

export function extractJD(html: string): ExtractedContent {
  // Extract large text blocks (likely JD)
  const textContent = extractTextContent(html);

  // Extract heading (job title)
  const jobTitle = extractHeading(html);

  // Extract company
  const company = extractCompany(html);

  return {
    jobDescription: textContent,
    jobTitle,
    company,
  };
}

function extractTextContent(html: string): string {
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "");
  text = text.replace(/<[^>]*>/g, " ");
  text = text.replace(/\s+/g, " ").trim();
  return text.substring(0, 5000);
}

function extractHeading(html: string): string {
  const headingMatch = html.match(/<h[1-3][^>]*>([^<]+)<\/h[1-3]>/);
  return headingMatch ? headingMatch[1].trim() : "Job Title (Not Found)";
}

function extractCompany(html: string): string {
  const companyMatch = html.match(/[Cc]ompany[\s:]*([^<\n]+)/);
  return companyMatch ? companyMatch[1].trim() : "Company (Not Found)";
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/extension
npm run test -- extractors
# Expected: PASS
```

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/content/extractors/ tests/extension/extractors.test.ts
git commit -m "feat: implement job description extraction"
```

---

### Task 1.6: Form Field Detection & Type Inference

**Files:**
- Create: `packages/extension/src/content/extractors/form.ts`
- Modify: `packages/extension/src/content/extractors/index.ts`
- Create: `tests/extension/extractors.test.ts` (add form tests)

**Interfaces:**
- Consumes: DOM HTML, `FormField` type
- Produces: `FormField[]` with type inference + confidence

---

- [ ] **Step 1: Write failing test for form field detection**

```typescript
// Add to tests/extension/extractors.test.ts
describe("Form Field Extraction", () => {
  it("should detect name input field", () => {
    const html = `<input type="text" name="name" placeholder="Full Name" />`;
    const fields = extractFormFields(html);

    expect(fields).toHaveLength(1);
    expect(fields[0].label).toContain("name");
    expect(fields[0].extractedValueType).toBe("name");
    expect(fields[0].matchConfidence).toBeGreaterThan(0.8);
  });

  it("should detect email input field", () => {
    const html = `<input type="email" name="email" placeholder="your@email.com" />`;
    const fields = extractFormFields(html);

    expect(fields[0].extractedValueType).toBe("email");
    expect(fields[0].matchConfidence).toBeGreaterThan(0.8);
  });

  it("should detect resume file upload", () => {
    const html = `<input type="file" name="resume" accept=".pdf,.doc" />`;
    const fields = extractFormFields(html);

    expect(fields[0].extractedValueType).toBe("resume");
    expect(fields[0].type).toBe("file");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/extension
npm run test -- extractors
# Expected: FAIL - "extractFormFields not exported"
```

- [ ] **Step 3: Create packages/extension/src/content/extractors/form.ts**

```typescript
import { FormField } from "../../../../lib/shared/types";
import { FIELD_TYPE_KEYWORDS, CONFIDENCE_THRESHOLDS } from "../../../../lib/shared/constants";

export function extractFormFields(html: string): FormField[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const fields: FormField[] = [];
  const inputs = doc.querySelectorAll("input, textarea, select");

  inputs.forEach((element, index) => {
    const field = parseFormField(element as HTMLElement, index);
    fields.push(field);
  });

  return fields;
}

function parseFormField(element: HTMLElement, index: number): FormField {
  const tagName = element.tagName.toLowerCase();
  const id = element.getAttribute("id") || element.getAttribute("name") || `field-${index}`;
  const label = extractLabel(element);
  const placeholder = element.getAttribute("placeholder") || "";
  const required = element.hasAttribute("required") || element.getAttribute("required") === "true";

  let type: FormField["type"] = "text";
  if (tagName === "textarea") type = "textarea";
  if (tagName === "select") type = "select";
  if (element.getAttribute("type")) {
    const htmlType = element.getAttribute("type")!.toLowerCase();
    if (["email", "tel", "file", "checkbox", "radio"].includes(htmlType)) {
      type = htmlType as any;
    }
  }

  const { valueType, confidence } = inferFieldType(label, placeholder, type);

  return {
    id,
    label,
    type,
    placeholder,
    required,
    extractedValueType: valueType,
    matchConfidence: confidence,
    validated: false,
  };
}

function extractLabel(element: HTMLElement): string {
  // Try to find associated label
  const id = element.getAttribute("id");
  if (id) {
    const label = document.querySelector(`label[for="${id}"]`);
    if (label) return label.textContent?.trim() || "";
  }

  // Try parent label
  const parentLabel = element.closest("label");
  if (parentLabel) return parentLabel.textContent?.trim().replace(element.textContent || "", "").trim() || "";

  // Fallback to placeholder or name
  return element.getAttribute("placeholder") || element.getAttribute("name") || "Field";
}

function inferFieldType(
  label: string,
  placeholder: string,
  htmlType: string
): { valueType: string | null; confidence: number } {
  const combinedText = `${label} ${placeholder}`.toLowerCase();

  for (const [valueType, keywords] of Object.entries(FIELD_TYPE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (combinedText.includes(keyword)) {
        let confidence = 0.7;

        // Boost confidence for exact HTML type match
        if (htmlType === valueType) confidence += 0.2;
        if (htmlType === "file" && valueType === "resume") confidence = 0.9;
        if (htmlType === "email" && valueType === "email") confidence = 0.95;

        return { valueType, confidence: Math.min(confidence, 1.0) };
      }
    }
  }

  // HTML type hints
  if (htmlType === "email") return { valueType: "email", confidence: 0.85 };
  if (htmlType === "tel") return { valueType: "phone", confidence: 0.85 };
  if (htmlType === "file") return { valueType: "resume", confidence: 0.7 };

  return { valueType: null, confidence: 0.0 };
}
```

- [ ] **Step 4: Update extractors/index.ts to export form extraction**

```typescript
export { extractFormFields } from "./form";
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/extension
npm run test -- extractors
# Expected: PASS
```

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/content/extractors/form.ts tests/extension/extractors.test.ts
git commit -m "feat: implement form field detection and type inference"
```

---

### Task 1.7: Content Script Main Loop

**Files:**
- Modify: `packages/extension/src/content/content.ts`
- Create: `tests/extension/messaging.test.ts`

**Interfaces:**
- Consumes: DOM, `detect()`, `extractJD()`, `extractFormFields()`
- Produces: Messages to background service worker

---

- [ ] **Step 1: Write failing test for content script messaging**

```typescript
// tests/extension/messaging.test.ts
import { describe, it, expect } from "vitest";

describe("Content Script Messaging", () => {
  it("should send JOB_EXTRACTED message to background", async () => {
    // Mock chrome.runtime.sendMessage
    const messages: any[] = [];
    (global as any).chrome = {
      runtime: {
        sendMessage: (msg: any) => messages.push(msg),
      },
    };

    // Import and run content script logic
    const { extractAndSend } = await import(
      "../../packages/extension/src/content/content"
    );

    await extractAndSend(document.documentElement.outerHTML);

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("JOB_EXTRACTED");
    expect(messages[0].data).toHaveProperty("jobDescription");
    expect(messages[0].data).toHaveProperty("formFields");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/extension
npm run test -- messaging
# Expected: FAIL
```

- [ ] **Step 3: Implement packages/extension/src/content/content.ts**

```typescript
import { detect } from "./detectors/index";
import { extractJD, extractFormFields } from "./extractors/index";
import { ExtractedJobData } from "../types";
import { v4 as uuidv4 } from "uuid";

console.log("[ApplyMate] Content script loaded on:", window.location.href);

export async function extractAndSend(html: string) {
  try {
    // Step 1: Detect job board
    const detectionResult = detect({
      url: window.location.href,
      html,
    });

    console.log("[ApplyMate] Detection result:", detectionResult);

    // Step 2: Extract JD
    const { jobDescription, jobTitle, company } = extractJD(html, detectionResult.board);

    // Step 3: Extract form fields
    const formFields = extractFormFields(html);

    // Step 4: Compose ExtractedJobData
    const extractedJobData: ExtractedJobData = {
      id: uuidv4(),
      url: window.location.href,
      timestamp: new Date().toISOString(),
      board: detectionResult.board,
      boardConfidence: detectionResult.confidence,
      jobTitle,
      company,
      jobDescription,
      formFields,
      userValidated: false,
    };

    // Step 5: Send to background
    chrome.runtime.sendMessage(
      {
        type: "JOB_EXTRACTED",
        data: extractedJobData,
      },
      (response) => {
        if (response && response.status === "received") {
          console.log("[ApplyMate] Background acknowledged extraction");
        }
      }
    );

    // Step 6: Inject extension button into page
    injectExtensionButton();
  } catch (error) {
    console.error("[ApplyMate] Extraction error:", error);
    chrome.runtime.sendMessage({
      type: "ERROR",
      error: String(error),
    });
  }
}

function injectExtensionButton() {
  if (document.getElementById("applymate-button")) return; // Already injected

  const button = document.createElement("button");
  button.id = "applymate-button";
  button.innerText = "ApplyMate";
  button.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    z-index: 10000;
    padding: 8px 16px;
    background: #4F46E5;
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: bold;
  `;

  button.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" });
  });

  document.body.appendChild(button);
}

// Auto-extract on page load
extractAndSend(document.documentElement.outerHTML);

// Also listen for manual refresh
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "EXTRACT_JOB_DATA") {
    extractAndSend(document.documentElement.outerHTML);
    sendResponse({ status: "extraction_started" });
  }
});
```

- [ ] **Step 4: Add uuid dependency**

```bash
cd packages/extension
npm install uuid
npm install --save-dev @types/uuid
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd packages/extension
npm run test -- messaging
# Expected: PASS
```

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/content/content.ts tests/extension/messaging.test.ts
git commit -m "feat: implement content script extraction and messaging"
```

---

### Task 1.8: Background Service Worker

**Files:**
- Modify: `packages/extension/src/background.ts`
- Modify: `packages/extension/manifest.json`

**Interfaces:**
- Consumes: Messages from content script
- Produces: Side panel opens, data stored in `chrome.storage.session`

---

- [ ] **Step 1: Implement packages/extension/src/background.ts**

```typescript
import { MessageFromContent, ExtractedJobData } from "./types";

console.log("[ApplyMate] Background service worker started");

// Global state
let lastExtractedJobData: ExtractedJobData | null = null;

// Listen for messages from content script
chrome.runtime.onMessage.addListener((request: MessageFromContent, sender, sendResponse) => {
  console.log("[ApplyMate] Background received message:", request.type);

  if (request.type === "JOB_EXTRACTED") {
    handleJobExtracted(request.data);
    sendResponse({ status: "received" });
  } else if (request.type === "ERROR") {
    console.error("[ApplyMate] Content script error:", request.error);
  } else if (request.type === "OPEN_SIDE_PANEL") {
    openSidePanel();
    sendResponse({ status: "side_panel_opened" });
  }
});

async function handleJobExtracted(data: ExtractedJobData) {
  lastExtractedJobData = data;

  // Store in session storage
  await chrome.storage.session.set({
    lastExtractedJobData: data,
  });

  console.log("[ApplyMate] Stored extracted job data in session:", data.id);

  // Open side panel
  openSidePanel();
}

async function openSidePanel() {
  if (!chrome.sidePanel) {
    console.warn("[ApplyMate] sidePanel API not available");
    return;
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
      console.log("[ApplyMate] Side panel opened");
    }
  } catch (error) {
    console.error("[ApplyMate] Failed to open side panel:", error);
  }
}

// Listen for background -> side panel messages
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_EXTRACTED_DATA") {
    chrome.storage.session.get("lastExtractedJobData", (result) => {
      sendResponse({
        data: result.lastExtractedJobData || null,
      });
    });
    return true; // Keep channel open for async response
  }
});
```

- [ ] **Step 2: Update manifest to include storage permission**

```json
{
  "manifest_version": 3,
  "name": "ApplyMate",
  "version": "1.0.0",
  "description": "AI-powered job application automation",
  "permissions": [
    "activeTab",
    "scripting",
    "sidePanel",
    "storage"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "background": {
    "service_worker": "dist/background.js",
    "type": "module"
  },
  "action": {
    "default_icon": "icon.png",
    "default_title": "ApplyMate: Auto-fill job applications"
  },
  "side_panel": {
    "default_path": "side-panel.html"
  },
  "icons": {
    "16": "icon.png",
    "48": "icon.png",
    "128": "icon.png"
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/extension/src/background.ts packages/extension/manifest.json
git commit -m "feat: implement background service worker with session storage"
```

---

### Task 1.9: Side Panel UI - Tab 1 (Job Data Review)

**Files:**
- Create: `packages/extension/src/ui/components/JobDataReview.tsx`
- Modify: `packages/extension/src/ui/side-panel.tsx`
- Create: `packages/extension/src/utils/storage.ts`
- Create: `packages/extension/src/utils/messaging.ts`

**Interfaces:**
- Consumes: `ExtractedJobData` from session storage
- Produces: UI for reviewing/editing job data

---

- [ ] **Step 1: Create storage utility**

```typescript
// packages/extension/src/utils/storage.ts
export async function getExtractedJobData() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "GET_EXTRACTED_DATA" }, (response) => {
      resolve(response?.data || null);
    });
  });
}

export async function updateExtractedJobData(data: any) {
  return new Promise((resolve) => {
    chrome.storage.session.set({ lastExtractedJobData: data }, () => {
      resolve(data);
    });
  });
}
```

- [ ] **Step 2: Create messaging utility**

```typescript
// packages/extension/src/utils/messaging.ts
export function sendToBackground(message: any) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response);
    });
  });
}
```

- [ ] **Step 3: Create JobDataReview component**

```typescript
// packages/extension/src/ui/components/JobDataReview.tsx
import React, { useState } from "react";
import { ExtractedJobData } from "../../types";

interface Props {
  data: ExtractedJobData;
  onNext: () => void;
}

export function JobDataReview({ data, onNext }: Props) {
  const [jobTitle, setJobTitle] = useState(data.jobTitle);
  const [company, setCompany] = useState(data.company);
  const [jd, setJd] = useState(data.jobDescription);

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold">Job Data Review</h2>

      <div>
        <label className="block text-sm font-medium">Job Title</label>
        <input
          type="text"
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          className="w-full border rounded px-2 py-1"
        />
      </div>

      <div>
        <label className="block text-sm font-medium">Company</label>
        <input
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          className="w-full border rounded px-2 py-1"
        />
      </div>

      <div>
        <label className="block text-sm font-medium">Job Description</label>
        <textarea
          value={jd}
          onChange={(e) => setJd(e.target.value)}
          className="w-full border rounded px-2 py-1 h-40"
        />
      </div>

      <div className="text-xs text-gray-500">
        Detected: {data.board} ({Math.round(data.boardConfidence * 100)}% confidence)
      </div>

      <button
        onClick={onNext}
        className="w-full bg-blue-600 text-white py-2 rounded font-medium"
      >
        Next: Validate Form Fields →
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Create side-panel.tsx with Tab 1**

```typescript
// packages/extension/src/ui/side-panel.tsx
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { JobDataReview } from "./components/JobDataReview";
import { ExtractedJobData, SidePanelState } from "../types";
import { getExtractedJobData } from "../utils/storage";

function App() {
  const [state, setState] = useState<SidePanelState>({
    extractedJobData: undefined,
    currentTab: "data-review",
    isLoading: true,
  });

  useEffect(() => {
    loadExtractedData();

    // Listen for new extractions
    const interval = setInterval(loadExtractedData, 1000);
    return () => clearInterval(interval);
  }, []);

  async function loadExtractedData() {
    const data = await getExtractedJobData();
    if (data) {
      setState((prev) => ({
        ...prev,
        extractedJobData: data,
        isLoading: false,
      }));
    }
  }

  if (state.isLoading) {
    return <div className="p-4">Loading...</div>;
  }

  if (!state.extractedJobData) {
    return (
      <div className="p-4">
        <p>No job data detected. Visit a job posting and click the ApplyMate button.</p>
      </div>
    );
  }

  return (
    <div className="w-80 max-h-screen overflow-y-auto bg-white">
      {state.currentTab === "data-review" && (
        <JobDataReview
          data={state.extractedJobData}
          onNext={() => setState((prev) => ({ ...prev, currentTab: "form-validation" }))}
        />
      )}

      {state.currentTab === "form-validation" && <div>Form Validation (TODO)</div>}
      {state.currentTab === "tailoring-review" && <div>Tailoring Review (TODO)</div>}
      {state.currentTab === "form-auto-fill" && <div>Form Auto-Fill (TODO)</div>}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("app") || document.body).render(<App />);
```

- [ ] **Step 5: Build and verify no errors**

```bash
cd packages/extension
npm run build
# Expected: dist/ contains compiled JS, no errors
```

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/ui/components/JobDataReview.tsx packages/extension/src/ui/side-panel.tsx packages/extension/src/utils/
git commit -m "feat: implement side panel Tab 1 - Job Data Review"
```

---

### Task 1.10: Side Panel UI - Tab 2 (Form Validation)

**Files:**
- Create: `packages/extension/src/ui/components/FormValidation.tsx`
- Modify: `packages/extension/src/ui/side-panel.tsx`

**Interfaces:**
- Consumes: `FormField[]` from `ExtractedJobData`
- Produces: UI for validating form fields, user must ✓ each field

---

- [ ] **Step 1: Create FormValidation component**

```typescript
// packages/extension/src/ui/components/FormValidation.tsx
import React, { useState } from "react";
import { FormField } from "../../types";
import { FIELD_TYPE_KEYWORDS } from "../../../../../lib/shared/constants";

interface Props {
  fields: FormField[];
  onProceed: () => void;
}

export function FormValidation({ fields: initialFields, onProceed }: Props) {
  const [fields, setFields] = useState<FormField[]>(initialFields);
  const allValidated = fields.every((f) => f.validated);

  function toggleValidated(index: number) {
    const updated = [...fields];
    updated[index].validated = !updated[index].validated;
    setFields(updated);
  }

  function changeFieldType(index: number, newType: string) {
    const updated = [...fields];
    updated[index].userSelectedValueType = newType;
    updated[index].validated = true;
    setFields(updated);
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold">Form Validation</h2>

      <div className="space-y-3">
        {fields.map((field, idx) => (
          <div key={field.id} className="border rounded p-2 space-y-2">
            <div className="text-sm font-medium">{field.label}</div>

            <div className="text-xs text-gray-600">
              Type: {field.type}, Required: {field.required ? "Yes" : "No"}
            </div>

            <div className="text-xs">
              Detected as:{" "}
              <select
                value={field.userSelectedValueType || field.extractedValueType || "unknown"}
                onChange={(e) => changeFieldType(idx, e.target.value)}
                className="border rounded px-1 py-0"
              >
                <option value="name">Name</option>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="resume">Resume</option>
                <option value="cover-letter">Cover Letter</option>
                <option value="custom-q">Custom Question</option>
                <option value="unknown">Unknown</option>
              </select>
              {field.extractedValueType && (
                <span className="text-xs text-gray-500 ml-2">
                  ({Math.round(field.matchConfidence * 100)}% confidence)
                </span>
              )}
            </div>

            <label className="flex items-center text-sm">
              <input
                type="checkbox"
                checked={field.validated}
                onChange={() => toggleValidated(idx)}
                className="mr-2"
              />
              Validated
            </label>
          </div>
        ))}
      </div>

      <div className="text-sm text-gray-600">
        Status: {fields.filter((f) => f.validated).length} / {fields.length} validated
      </div>

      <button
        onClick={onProceed}
        disabled={!allValidated}
        className={`w-full py-2 rounded font-medium ${
          allValidated ? "bg-blue-600 text-white" : "bg-gray-300 text-gray-500 cursor-not-allowed"
        }`}
      >
        Proceed to Resume Generation →
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Update side-panel.tsx to include Tab 2**

```typescript
// Add to side-panel.tsx
import { FormValidation } from "./components/FormValidation";

// In App component, add:
{state.currentTab === "form-validation" && (
  <FormValidation
    fields={state.extractedJobData!.formFields}
    onProceed={() => setState((prev) => ({ ...prev, currentTab: "tailoring-review" }))}
  />
)}
```

- [ ] **Step 3: Build and verify**

```bash
cd packages/extension
npm run build
# Expected: No errors
```

- [ ] **Step 4: Commit**

```bash
git add packages/extension/src/ui/components/FormValidation.tsx
git commit -m "feat: implement side panel Tab 2 - Form Validation"
```

---

### Task 1.11: Manual Approval Gate #1

**Acceptance Criteria (Phase 1 Complete):**
- [ ] Content script detects LinkedIn + Indeed (test on 1 real posting each)
- [ ] JD extraction ≥90% accuracy
- [ ] Form fields detected (test on 2 forms)
- [ ] Side panel displays data + validation gate works
- [ ] Close + reopen panel → data persists
- [ ] 60/60 unit tests pass
- [ ] No silent failures (always show fallback UI or error message)

**Testing Instructions:**

```bash
# 1. Run all Phase 1 tests
cd packages/extension
npm run test
# Expected: 60/60 PASS

# 2. Manual test on LinkedIn
# - Visit: https://www.linkedin.com/jobs/view/3917640246/ (or any LinkedIn job)
# - Click extension button
# - Verify: JD extracted, form fields detected, validation gate shows
# - Close panel, reopen → data persists

# 3. Manual test on Indeed
# - Visit: https://www.indeed.com/jobs?q=software+engineer (search results)
# - Click on a job
# - Verify: JD extracted, form fields detected

# 4. Manual test fallback (unknown site)
# - Visit: any generic careers page
# - If not detected, verify: "Job board not detected" message appears
# - Option to manually enter data
```

**Sign-off Checklist:**
- [ ] All automated tests pass (60/60)
- [ ] LinkedIn extraction works manually (test 1 posting)
- [ ] Indeed extraction works manually (test 1 posting)
- [ ] Form field detection ≥90% accurate (test 2 forms)
- [ ] Side panel validation gate requires ✓ on all fields
- [ ] Session persistence works (close + reopen)
- [ ] No TBDs or TODOs in code

If all checks pass → **Proceed to Phase 2**
If any check fails → **Debug, fix, re-test**

---

## PHASE 2: 5-STAGE SKILL (Week 3-4)

**(Continues in next plan section due to length...)**

---

## EXECUTION HANDOFF

Plan complete and saved to `docs/superpowers/plans/2025-06-19-applymate-implementation.md`.

**Two execution options:**

**1. Subagent-Driven (Recommended)** — Fresh subagent per task, fast iteration, parallel work
   - Invoke: `superpowers:subagent-driven-development`
   - Benefit: Each task runs independently, automatic review between tasks

**2. Inline Execution** — Execute tasks in this session, batch with checkpoints
   - Invoke: `superpowers:executing-plans`
   - Benefit: Keep context warm, run multiple tasks sequentially

Which approach?
