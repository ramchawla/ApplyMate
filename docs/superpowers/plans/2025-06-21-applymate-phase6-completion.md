# ApplyMate Phase 6: Completion Implementation Plan

> **For agentic workers:** RECOMMENDED SUB-SKILL: Use `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make ApplyMate usable daily: a working local Tectonic PDF compile in the dashboard (replacing the dead-CDN SwiftLaTeX WASM path) and board-specific extractors for LinkedIn, Greenhouse, Lever, Ashby, and Workday with a generic fallback.

**Architecture:** The dashboard (local Next.js Node server) compiles LaTeX itself via a `/api/compile` route that shells to `tectonic`. The SwiftLaTeX WASM path and assets are deleted. Extraction gains one module per board, dispatched by the detected board, with the existing generic extractor as an always-on fallback.

**Tech Stack:** TypeScript, Next.js (Node runtime route), `node:child_process` + `tectonic` CLI, jsdom (tests), Vitest.

## Global Constraints

- Offline operation is NOT a goal; reliability on the user's machine is.
- PDF compile lives in the dashboard only (not the bridge); same-origin, no token/CORS.
- `tectonic` is a runtime prerequisite: `brew install tectonic`.
- Board extraction must never fail hard — always fall back to the generic extractor.
- Embedding dimension, bridge, skill, pgvector behavior are unchanged this cycle.
- TDD: failing test → minimal implementation → passing test → commit, every task.
- Reuse existing `ExtractedContent`, `DetectionResult`, `BOARD_DETECTION_PATTERNS`, generic `extractJDContent` / `extractFormFields`.

## Prerequisites

- [ ] New branch off `main`: `git checkout -b phase-6-completion`.
- [ ] (For the real PDF path, eventually) `brew install tectonic`. Not required to write/pass the deterministic tests.

---

## FILE STRUCTURE

```
lib/local/
├── compile-latex.ts                # NEW — tectonic child_process wrapper
└── latex-wasm.ts                   # DELETE

packages/dashboard/
├── app/api/compile/route.ts        # NEW — POST { latex } -> application/pdf
├── components/PdfCompiler.tsx       # MODIFY — POST to /api/compile
└── public/swiftlatex/              # DELETE (all vendored assets)

packages/extension/src/content/
├── detectors/
│   ├── index.ts                    # MODIFY — chain all 5 boards
│   ├── greenhouse.ts               # NEW
│   ├── lever.ts                    # NEW
│   ├── ashby.ts                    # NEW
│   └── workday.ts                  # NEW
└── extractors/
    ├── index.ts                    # MODIFY — dispatch by board
    └── boards/
        ├── util.ts                 # NEW — textOf helper
        ├── linkedin.ts             # NEW
        ├── greenhouse.ts           # NEW
        ├── lever.ts                # NEW
        ├── ashby.ts                # NEW
        └── workday.ts              # NEW

lib/shared/constants.ts             # MODIFY — add workday pattern

tests/dashboard/compile-latex.test.ts   # NEW
tests/extension/board-extractors.test.ts # NEW
tests/extension/detectors.test.ts        # MODIFY — add board URL cases
```

---

## Task 6.1: Local Tectonic Compile Wrapper

**Files:**
- Create: `lib/local/compile-latex.ts`
- Create: `tests/dashboard/compile-latex.test.ts`

**Interfaces:**
- Consumes: `node:child_process`, `node:fs/promises`, `node:os`
- Produces: `compileLatex(latex: string, binary?: string): Promise<Buffer>`; `class TectonicMissingError extends Error`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/dashboard/compile-latex.test.ts
import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import {
  compileLatex,
  TectonicMissingError,
} from "../../lib/local/compile-latex";

function hasTectonic(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("tectonic", ["--version"], (err) => resolve(!err));
  });
}

describe("compileLatex", () => {
  it("throws TectonicMissingError when the binary is absent", async () => {
    await expect(
      compileLatex("\\documentclass{article}\\begin{document}x\\end{document}", "tectonic-does-not-exist-xyz"),
    ).rejects.toBeInstanceOf(TectonicMissingError);
  });

  it("compiles a minimal document to PDF bytes when tectonic is installed", async () => {
    if (!(await hasTectonic())) return; // skip when not installed
    const pdf = await compileLatex(
      "\\documentclass{article}\\begin{document}Hello ApplyMate.\\end{document}",
    );
    expect(pdf[0]).toBe(0x25); // %
    expect(pdf[1]).toBe(0x50); // P
    expect(pdf.length).toBeGreaterThan(400);
  }, 120000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @applymate/dashboard test compile-latex`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the implementation**

```typescript
// lib/local/compile-latex.ts
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class TectonicMissingError extends Error {
  constructor() {
    super("tectonic not found. Install it: brew install tectonic");
    this.name = "TectonicMissingError";
  }
}

export async function compileLatex(
  latex: string,
  binary = "tectonic",
): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "applymate-tex-"));
  const texPath = join(dir, "resume.tex");
  const pdfPath = join(dir, "resume.pdf");
  try {
    await writeFile(texPath, latex, "utf8");
    await runTectonic(binary, texPath, dir);
    return await readFile(pdfPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runTectonic(
  binary: string,
  texPath: string,
  cwd: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      [texPath],
      { cwd, maxBuffer: 10 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (!err) return resolve();
        const e = err as NodeJS.ErrnoException;
        if (e.code === "ENOENT") return reject(new TectonicMissingError());
        reject(
          new Error(`tectonic failed:\n${String(stderr).slice(-2000)}`),
        );
      },
    );
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @applymate/dashboard test compile-latex`
Expected: PASS (the missing-binary test passes; the real-compile test runs only if `tectonic` is installed, otherwise returns early).

- [ ] **Step 5: Commit**

```bash
git add lib/local/compile-latex.ts tests/dashboard/compile-latex.test.ts
git commit -m "feat: local tectonic LaTeX-to-PDF compile wrapper"
```

---

## Task 6.2: Dashboard Compile API Route

**Files:**
- Create: `packages/dashboard/app/api/compile/route.ts`

**Interfaces:**
- Consumes: `compileLatex`, `TectonicMissingError`
- Produces: `POST /api/compile` → `application/pdf` | 400 | 503 | 500

- [ ] **Step 1: Create the route**

```typescript
// packages/dashboard/app/api/compile/route.ts
import { compileLatex, TectonicMissingError } from "../../../../../lib/local/compile-latex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let latex: unknown;
  try {
    ({ latex } = await req.json());
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof latex !== "string" || latex.trim().length === 0) {
    return Response.json({ error: "latex (non-empty string) required" }, { status: 400 });
  }

  try {
    const pdf = await compileLatex(latex);
    return new Response(new Uint8Array(pdf), {
      status: 200,
      headers: { "Content-Type": "application/pdf" },
    });
  } catch (err) {
    if (err instanceof TectonicMissingError) {
      return Response.json(
        { error: err.message, hint: "brew install tectonic" },
        { status: 503 },
      );
    }
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Build to verify the route compiles**

Run: `pnpm --filter @applymate/dashboard build`
Expected: build succeeds; `/api/compile` listed as a route.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/app/api/compile/route.ts
git commit -m "feat: dashboard /api/compile route (tectonic PDF)"
```

---

## Task 6.3: Switch PdfCompiler to the API + remove SwiftLaTeX

**Files:**
- Modify: `packages/dashboard/components/PdfCompiler.tsx`
- Delete: `lib/local/latex-wasm.ts`
- Delete: `packages/dashboard/public/swiftlatex/` (directory)

**Interfaces:**
- Consumes: `POST /api/compile`
- Produces: client PDF preview + download

- [ ] **Step 1: Replace PdfCompiler.tsx**

```tsx
"use client";
import { useState } from "react";

export function PdfCompiler({ latex }: { latex: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function compile() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ latex }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          [body.error, body.hint].filter(Boolean).join(" — ") ||
            `compile failed (${res.status})`,
        );
      }
      const blob = await res.blob();
      setUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={compile}
        disabled={busy}
        className="bg-blue-600 text-white px-3 py-1 rounded text-sm disabled:bg-gray-400"
      >
        {busy ? "Compiling…" : "Compile PDF"}
      </button>

      {error && (
        <div className="space-y-1">
          <pre className="text-xs text-red-600 whitespace-pre-wrap">{error}</pre>
          <p className="text-xs text-gray-500">
            Needs <code>tectonic</code> on the machine running the dashboard
            (<code>brew install tectonic</code>). The Raw LaTeX below can be
            compiled at Overleaf as a fallback.
          </p>
        </div>
      )}

      {url && (
        <div className="space-y-1">
          <a href={url} download="resume.pdf" className="text-sm text-blue-600">
            Download PDF
          </a>
          <iframe
            src={url}
            className="w-full h-96 border rounded"
            title="resume pdf"
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Delete the SwiftLaTeX code + assets**

```bash
git rm lib/local/latex-wasm.ts
git rm -r packages/dashboard/public/swiftlatex
```

- [ ] **Step 3: Verify no dangling references**

Run: `grep -rn "latex-wasm\|swiftlatex\|compileInBrowser\|SwiftLaTeX" packages lib --include=*.ts --include=*.tsx`
Expected: no matches in code (README mention is updated in Task 6.4).

- [ ] **Step 4: Build + type-check**

Run: `pnpm --filter @applymate/dashboard build && pnpm --filter @applymate/dashboard type-check`
Expected: success, no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/components/PdfCompiler.tsx
git commit -m "feat: compile PDF via dashboard API; remove SwiftLaTeX WASM"
```

---

## Task 6.4: PDF Docs + Resume Wording

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing
- Produces: corrected PDF section + prereq

- [ ] **Step 1: Update the resume-alignment PDF line in README.md**

Replace the existing client-side/SwiftLaTeX résumé-alignment bullet (the line starting with `✅ **Client-side LaTeX→PDF via WASM**`) with:
```markdown
✅ **LaTeX→PDF compile service** — the Next.js dashboard exposes a Node
`/api/compile` route that shells to **Tectonic** to render résumé LaTeX to PDF
locally (zero external service cost). Install once with `brew install tectonic`.
```

- [ ] **Step 2: Add the prerequisite to the Quickstart**

In the Quickstart code block in `README.md`, add this line after `pnpm install`:
```bash
# PDF compile prerequisite (one-time)
brew install tectonic
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document local Tectonic compile + prerequisite"
```

---

## Task 6.5: Workday Detection Pattern + Board Detectors

**Files:**
- Modify: `lib/shared/constants.ts`
- Create: `packages/extension/src/content/detectors/greenhouse.ts`
- Create: `packages/extension/src/content/detectors/lever.ts`
- Create: `packages/extension/src/content/detectors/ashby.ts`
- Create: `packages/extension/src/content/detectors/workday.ts`
- Modify: `packages/extension/src/content/detectors/index.ts`
- Modify: `tests/extension/detectors.test.ts`

**Interfaces:**
- Consumes: `BOARD_DETECTION_PATTERNS`, `DetectionResult`, `DetectionInput`
- Produces: `detectGreenhouse`, `detectLever`, `detectAshby`, `detectWorkday`; extended `detect()` chain

- [ ] **Step 1: Add the Workday pattern to constants.ts**

In `lib/shared/constants.ts`, add to `BOARD_DETECTION_PATTERNS` (after `ashby`):
```typescript
  workday: {
    urlPattern: /myworkdayjobs\.com/,
    domSelectors: ["data-automation-id"],
    confidence: 0.95,
  },
```

- [ ] **Step 2: Write failing detector tests**

Add to `tests/extension/detectors.test.ts` inside the existing `describe("Board Detection", ...)`:
```typescript
  it("detects Greenhouse from URL", () => {
    const r = detect({ url: "https://boards.greenhouse.io/acme/jobs/123", html: "" });
    expect(r.board).toBe("greenhouse");
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("detects Lever from URL", () => {
    const r = detect({ url: "https://jobs.lever.co/acme/abc", html: "" });
    expect(r.board).toBe("lever");
  });

  it("detects Ashby from URL", () => {
    const r = detect({ url: "https://jobs.ashby.com/acme/xyz", html: "" });
    expect(r.board).toBe("ashby");
  });

  it("detects Workday from URL", () => {
    const r = detect({
      url: "https://acme.wd1.myworkdayjobs.com/en-US/careers/job/123",
      html: "",
    });
    expect(r.board).toBe("workday");
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @applymate/extension test detectors`
Expected: FAIL (greenhouse/lever/ashby/workday currently fall through to generic/unknown).

- [ ] **Step 4: Create the four detector modules**

`packages/extension/src/content/detectors/greenhouse.ts`:
```typescript
import { BOARD_DETECTION_PATTERNS } from "../../../../../lib/shared/constants";
import { DetectionResult } from "../../../../../lib/shared/types";
import { DetectionInput } from "./index";

export function detectGreenhouse(input: DetectionInput): DetectionResult {
  const pattern = BOARD_DETECTION_PATTERNS.greenhouse;
  if (pattern.urlPattern.test(input.url)) {
    return { board: "greenhouse", confidence: pattern.confidence, method: "url_pattern", detectedElements: {} };
  }
  for (const selector of pattern.domSelectors) {
    if (input.html.includes(selector)) {
      return { board: "greenhouse", confidence: 0.8, method: "dom_structure", detectedElements: { jdContainer: selector } };
    }
  }
  return { board: "unknown", confidence: 0, method: "fallback", detectedElements: {} };
}
```

`packages/extension/src/content/detectors/lever.ts`:
```typescript
import { BOARD_DETECTION_PATTERNS } from "../../../../../lib/shared/constants";
import { DetectionResult } from "../../../../../lib/shared/types";
import { DetectionInput } from "./index";

export function detectLever(input: DetectionInput): DetectionResult {
  const pattern = BOARD_DETECTION_PATTERNS.lever;
  if (pattern.urlPattern.test(input.url)) {
    return { board: "lever", confidence: pattern.confidence, method: "url_pattern", detectedElements: {} };
  }
  for (const selector of pattern.domSelectors) {
    if (input.html.includes(selector)) {
      return { board: "lever", confidence: 0.8, method: "dom_structure", detectedElements: { jdContainer: selector } };
    }
  }
  return { board: "unknown", confidence: 0, method: "fallback", detectedElements: {} };
}
```

`packages/extension/src/content/detectors/ashby.ts`:
```typescript
import { BOARD_DETECTION_PATTERNS } from "../../../../../lib/shared/constants";
import { DetectionResult } from "../../../../../lib/shared/types";
import { DetectionInput } from "./index";

export function detectAshby(input: DetectionInput): DetectionResult {
  const pattern = BOARD_DETECTION_PATTERNS.ashby;
  if (pattern.urlPattern.test(input.url)) {
    return { board: "ashby", confidence: pattern.confidence, method: "url_pattern", detectedElements: {} };
  }
  for (const selector of pattern.domSelectors) {
    if (input.html.includes(selector)) {
      return { board: "ashby", confidence: 0.8, method: "dom_structure", detectedElements: { jdContainer: selector } };
    }
  }
  return { board: "unknown", confidence: 0, method: "fallback", detectedElements: {} };
}
```

`packages/extension/src/content/detectors/workday.ts`:
```typescript
import { BOARD_DETECTION_PATTERNS } from "../../../../../lib/shared/constants";
import { DetectionResult } from "../../../../../lib/shared/types";
import { DetectionInput } from "./index";

export function detectWorkday(input: DetectionInput): DetectionResult {
  const pattern = BOARD_DETECTION_PATTERNS.workday;
  if (pattern.urlPattern.test(input.url)) {
    return { board: "workday", confidence: pattern.confidence, method: "url_pattern", detectedElements: {} };
  }
  for (const selector of pattern.domSelectors) {
    if (input.html.includes(selector)) {
      return { board: "workday", confidence: 0.8, method: "dom_structure", detectedElements: { jdContainer: selector } };
    }
  }
  return { board: "unknown", confidence: 0, method: "fallback", detectedElements: {} };
}
```

- [ ] **Step 5: Wire them into the detect() chain**

Replace the body of `detect()` in `packages/extension/src/content/detectors/index.ts` (keep the imports for linkedin/indeed/generic, add the four new imports):
```typescript
import { DetectionResult } from "../../../../../lib/shared/types";
import { detectLinkedIn } from "./linkedin";
import { detectIndeed } from "./indeed";
import { detectGreenhouse } from "./greenhouse";
import { detectLever } from "./lever";
import { detectAshby } from "./ashby";
import { detectWorkday } from "./workday";
import { detectGeneric } from "./generic";

export interface DetectionInput {
  url: string;
  html: string;
}

export function detect(input: DetectionInput): DetectionResult {
  const boards = [
    detectLinkedIn,
    detectIndeed,
    detectGreenhouse,
    detectLever,
    detectAshby,
    detectWorkday,
  ];
  for (const fn of boards) {
    const result = fn(input);
    if (result.confidence > 0.7) return result;
  }
  return detectGeneric(input);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @applymate/extension test detectors`
Expected: PASS (all original + 4 new cases).

- [ ] **Step 7: Commit**

```bash
git add lib/shared/constants.ts packages/extension/src/content/detectors/ tests/extension/detectors.test.ts
git commit -m "feat: detect Greenhouse, Lever, Ashby, Workday job boards"
```

---

## Task 6.6: Board Extractor Util + LinkedIn/Greenhouse

**Files:**
- Create: `packages/extension/src/content/extractors/boards/util.ts`
- Create: `packages/extension/src/content/extractors/boards/linkedin.ts`
- Create: `packages/extension/src/content/extractors/boards/greenhouse.ts`
- Create: `tests/extension/board-extractors.test.ts`

**Interfaces:**
- Consumes: `ExtractedContent` (from `extractors/jd`)
- Produces: `textOf(doc, selectors)`, `extract(doc): ExtractedContent` for linkedin + greenhouse

- [ ] **Step 1: Write failing tests**

```typescript
// tests/extension/board-extractors.test.ts
import { describe, it, expect } from "vitest";
import { extract as extractLinkedIn } from "../../packages/extension/src/content/extractors/boards/linkedin";
import { extract as extractGreenhouse } from "../../packages/extension/src/content/extractors/boards/greenhouse";

function doc(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("board extractors: linkedin", () => {
  it("pulls title, company, and JD from LinkedIn markup", () => {
    const d = doc(`
      <h1 class="job-details-jobs-unified-top-card__job-title">Senior Rust Engineer</h1>
      <a class="job-details-jobs-unified-top-card__company-name">Acme Corp</a>
      <div class="jobs-description__content">Build async Rust systems at scale.</div>
    `);
    const r = extractLinkedIn(d);
    expect(r.jobTitle).toBe("Senior Rust Engineer");
    expect(r.company).toBe("Acme Corp");
    expect(r.jobDescription).toContain("async Rust");
  });
});

describe("board extractors: greenhouse", () => {
  it("pulls title and JD from Greenhouse markup", () => {
    const d = doc(`
      <h1 class="app-title">Backend Engineer</h1>
      <div id="content">We need Go and Postgres experience.</div>
    `);
    const r = extractGreenhouse(d);
    expect(r.jobTitle).toBe("Backend Engineer");
    expect(r.jobDescription).toContain("Postgres");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @applymate/extension test board-extractors`
Expected: FAIL (modules not found).

- [ ] **Step 3: Create the shared util**

```typescript
// packages/extension/src/content/extractors/boards/util.ts
export function textOf(doc: Document, selectors: string[]): string {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  return "";
}

export function attrOf(
  doc: Document,
  selector: string,
  attr: string,
): string {
  return doc.querySelector(selector)?.getAttribute(attr)?.trim() ?? "";
}
```

- [ ] **Step 4: Create the LinkedIn extractor**

```typescript
// packages/extension/src/content/extractors/boards/linkedin.ts
import type { ExtractedContent } from "../jd";
import { textOf } from "./util";

export function extract(doc: Document): ExtractedContent {
  return {
    jobTitle: textOf(doc, [
      ".job-details-jobs-unified-top-card__job-title",
      ".topcard__title",
      "h1",
    ]),
    company: textOf(doc, [
      ".job-details-jobs-unified-top-card__company-name",
      ".topcard__org-name-link",
    ]),
    jobDescription: textOf(doc, [
      ".jobs-description__content",
      ".description__text",
    ]),
  };
}
```

- [ ] **Step 5: Create the Greenhouse extractor**

```typescript
// packages/extension/src/content/extractors/boards/greenhouse.ts
import type { ExtractedContent } from "../jd";
import { textOf, attrOf } from "./util";

export function extract(doc: Document): ExtractedContent {
  return {
    jobTitle: textOf(doc, [".app-title", "h1.section-header", "h1"]),
    company:
      textOf(doc, [".company-name"]) ||
      attrOf(doc, "meta[property='og:site_name']", "content"),
    jobDescription: textOf(doc, ["#content", ".job__description", "#job_description"]),
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @applymate/extension test board-extractors`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/extension/src/content/extractors/boards/util.ts packages/extension/src/content/extractors/boards/linkedin.ts packages/extension/src/content/extractors/boards/greenhouse.ts tests/extension/board-extractors.test.ts
git commit -m "feat: LinkedIn + Greenhouse board extractors"
```

---

## Task 6.7: Lever / Ashby / Workday Extractors

**Files:**
- Create: `packages/extension/src/content/extractors/boards/lever.ts`
- Create: `packages/extension/src/content/extractors/boards/ashby.ts`
- Create: `packages/extension/src/content/extractors/boards/workday.ts`
- Modify: `tests/extension/board-extractors.test.ts`

**Interfaces:**
- Consumes: `ExtractedContent`, `textOf`, `attrOf`
- Produces: `extract(doc)` for lever, ashby, workday

- [ ] **Step 1: Add failing tests**

Append to `tests/extension/board-extractors.test.ts`:
```typescript
import { extract as extractLever } from "../../packages/extension/src/content/extractors/boards/lever";
import { extract as extractAshby } from "../../packages/extension/src/content/extractors/boards/ashby";
import { extract as extractWorkday } from "../../packages/extension/src/content/extractors/boards/workday";

describe("board extractors: lever", () => {
  it("pulls title and JD from Lever markup", () => {
    const d = doc(`
      <div class="posting-headline"><h2>Platform Engineer</h2></div>
      <div class="section-wrapper page-full-width">Kafka and Kubernetes at scale.</div>
    `);
    const r = extractLever(d);
    expect(r.jobTitle).toBe("Platform Engineer");
    expect(r.jobDescription).toContain("Kafka");
  });
});

describe("board extractors: ashby", () => {
  it("pulls title and JD from Ashby markup", () => {
    const d = doc(`
      <h1>Founding Engineer</h1>
      <div class="_descriptionText_abc123">Rust, TypeScript, and distributed systems.</div>
    `);
    const r = extractAshby(d);
    expect(r.jobTitle).toBe("Founding Engineer");
    expect(r.jobDescription).toContain("distributed systems");
  });
});

describe("board extractors: workday", () => {
  it("pulls title and JD from Workday automation ids", () => {
    const d = doc(`
      <h2 data-automation-id="jobPostingHeader">Software Engineer II</h2>
      <div data-automation-id="jobPostingDescription">Java, Spring, and AWS.</div>
    `);
    const r = extractWorkday(d);
    expect(r.jobTitle).toBe("Software Engineer II");
    expect(r.jobDescription).toContain("Spring");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @applymate/extension test board-extractors`
Expected: FAIL (lever/ashby/workday modules not found).

- [ ] **Step 3: Create the Lever extractor**

```typescript
// packages/extension/src/content/extractors/boards/lever.ts
import type { ExtractedContent } from "../jd";
import { textOf, attrOf } from "./util";

export function extract(doc: Document): ExtractedContent {
  return {
    jobTitle: textOf(doc, [".posting-headline h2", "h2"]),
    company: attrOf(doc, "meta[property='og:site_name']", "content"),
    jobDescription: textOf(doc, [
      ".section-wrapper.page-full-width",
      ".section[data-qa='job-description']",
      ".content",
    ]),
  };
}
```

- [ ] **Step 4: Create the Ashby extractor**

```typescript
// packages/extension/src/content/extractors/boards/ashby.ts
import type { ExtractedContent } from "../jd";
import { textOf, attrOf } from "./util";

export function extract(doc: Document): ExtractedContent {
  return {
    jobTitle: textOf(doc, ["h1"]),
    company: attrOf(doc, "meta[property='og:site_name']", "content"),
    jobDescription: textOf(doc, ["[class*='descriptionText']", "main"]),
  };
}
```

- [ ] **Step 5: Create the Workday extractor**

```typescript
// packages/extension/src/content/extractors/boards/workday.ts
import type { ExtractedContent } from "../jd";
import { textOf, attrOf } from "./util";

export function extract(doc: Document): ExtractedContent {
  return {
    jobTitle: textOf(doc, ["[data-automation-id='jobPostingHeader']", "h1"]),
    company: attrOf(doc, "meta[property='og:site_name']", "content"),
    jobDescription: textOf(doc, [
      "[data-automation-id='jobPostingDescription']",
    ]),
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @applymate/extension test board-extractors`
Expected: PASS (5 tests total).

- [ ] **Step 7: Commit**

```bash
git add packages/extension/src/content/extractors/boards/lever.ts packages/extension/src/content/extractors/boards/ashby.ts packages/extension/src/content/extractors/boards/workday.ts tests/extension/board-extractors.test.ts
git commit -m "feat: Lever, Ashby, Workday board extractors"
```

---

## Task 6.8: Dispatch Board Extractors with Generic Fallback

**Files:**
- Modify: `packages/extension/src/content/extractors/index.ts`
- Modify: `tests/extension/board-extractors.test.ts`

**Interfaces:**
- Consumes: all board `extract` modules, `extractJDContent` (generic), `ExtractedContent`
- Produces: `extractJD(html, board)` dispatches by board, falls back to generic

- [ ] **Step 1: Add failing dispatch + fallback tests**

Append to `tests/extension/board-extractors.test.ts`:
```typescript
import { extractJD } from "../../packages/extension/src/content/extractors/index";

describe("extractJD dispatch", () => {
  it("routes a workday board to the workday extractor", () => {
    const html = `<h2 data-automation-id="jobPostingHeader">Workday Role</h2>
      <div data-automation-id="jobPostingDescription">Workday-specific JD body text here.</div>`;
    const r = extractJD(html, "workday");
    expect(r.jobTitle).toBe("Workday Role");
    expect(r.jobDescription).toContain("Workday-specific");
  });

  it("falls back to generic when board selectors miss", () => {
    const html = `<h1>Generic Title</h1>
      <p>${"Plenty of generic job description text. ".repeat(10)}</p>`;
    const r = extractJD(html, "lever"); // lever selectors absent
    expect(r.jobDescription).toContain("generic job description");
  });

  it("uses generic extractor for an unknown board", () => {
    const html = `<h1>Unknown Co Role</h1><div>Some role details here that are long enough.</div>`;
    const r = extractJD(html, "generic");
    expect(r.jobTitle).toContain("Unknown Co Role");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @applymate/extension test board-extractors`
Expected: FAIL (current `extractJD` ignores board, always generic → the workday dispatch assertion fails).

- [ ] **Step 3: Rewrite extractors/index.ts dispatch**

```typescript
// packages/extension/src/content/extractors/index.ts
import { extractJDContent, ExtractedContent } from "./jd";
import { extract as linkedin } from "./boards/linkedin";
import { extract as greenhouse } from "./boards/greenhouse";
import { extract as lever } from "./boards/lever";
import { extract as ashby } from "./boards/ashby";
import { extract as workday } from "./boards/workday";

export type { ExtractedContent } from "./jd";
export { extractFormFields } from "./form";

const BOARD_EXTRACTORS: Record<string, (doc: Document) => ExtractedContent> = {
  linkedin,
  greenhouse,
  lever,
  ashby,
  workday,
};

export function extractJD(html: string, board: string): ExtractedContent {
  const boardExtract = BOARD_EXTRACTORS[board];
  if (boardExtract) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const result = boardExtract(doc);
    if (isComplete(result)) return result;
    // partial board result: backfill missing fields from generic
    const generic = extractJDContent(html);
    return {
      jobTitle: result.jobTitle || generic.jobTitle,
      company: result.company || generic.company,
      jobDescription: result.jobDescription || generic.jobDescription,
    };
  }
  return extractJDContent(html);
}

function isComplete(c: ExtractedContent): boolean {
  return (
    c.jobTitle.length > 0 &&
    c.jobDescription.length > 0 &&
    c.company.length > 0
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @applymate/extension test board-extractors`
Expected: PASS (all dispatch + fallback tests). The fallback test passes because Lever selectors miss → fields backfilled from generic.

- [ ] **Step 5: Run the full extension suite (no regressions)**

Run: `pnpm --filter @applymate/extension test`
Expected: all prior tests still pass (the original `extractors.test.ts` generic cases, pipeline E2E, etc.).

- [ ] **Step 6: Build + type-check**

Run: `pnpm --filter @applymate/extension build && pnpm --filter @applymate/extension type-check`
Expected: success, no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/extension/src/content/extractors/index.ts tests/extension/board-extractors.test.ts
git commit -m "feat: dispatch board extractors with generic backfill fallback"
```

---

## Task 6.9: Manual Approval Gate #6

**Acceptance Criteria (Phase 6 complete):**

Automated:
```bash
pnpm --filter @applymate/extension test
pnpm --filter @applymate/dashboard test
pnpm --filter @applymate/bridge test
pnpm --filter @applymate/skill test
pnpm --filter @applymate/extension type-check
pnpm --filter @applymate/dashboard type-check
pnpm --filter @applymate/extension build
pnpm --filter @applymate/dashboard build
```
- [ ] Extension tests pass (incl. new detectors + board-extractors).
- [ ] Dashboard tests pass (incl. compile-latex missing-binary path).
- [ ] Bridge + skill suites unchanged/green.
- [ ] No dangling SwiftLaTeX references (`grep` from Task 6.3 Step 3 is clean).
- [ ] Builds + type-checks clean.

Manual (you):
- [ ] `brew install tectonic`, then `pnpm --filter @applymate/dashboard dev`; open a real resume version → **Compile PDF** → PDF renders in the iframe.
- [ ] Load the rebuilt extension; on a LinkedIn / Greenhouse / Lever / Ashby / Workday posting confirm title/company/JD extract correctly (or fall back gracefully).

**Sign-off:** All green → merge `phase-6-completion` to `main`. ApplyMate is usable daily. Next: the enhancements cycle (hybrid retrieval, ATS scoring, eval harness, feedback loop).

---

## Self-Review

- **Spec coverage:** Section 1 PDF → Tasks 6.1 (wrapper), 6.2 (route), 6.3 (client + removal), 6.4 (docs). Section 2 extractors → 6.5 (detection), 6.6–6.7 (board modules), 6.8 (dispatch + fallback). Gate → 6.9.
- **No placeholders:** every step has complete code + exact commands/expected output.
- **Type consistency:** all board `extract(doc: Document): ExtractedContent` share one signature; `ExtractedContent` imported from `./jd` everywhere; `compileLatex(latex, binary?)` / `TectonicMissingError` consistent between 6.1, 6.2; `detect()` chain uses the new detector module names exactly as created in 6.5.
- **Known risk:** real-board DOM differs from fixtures; mitigated by generic backfill + the manual gate check on live postings. `tectonic` real-compile test is conditional (skips when absent) — the missing-binary path is always tested.
```
