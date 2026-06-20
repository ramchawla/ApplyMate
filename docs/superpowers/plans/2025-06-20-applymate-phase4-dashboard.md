# ApplyMate Phase 4: Dashboard + Persistence + Client-Side PDF — Implementation Plan

> **For agentic workers:** RECOMMENDED SUB-SKILL: Use `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Persist every application + resume version to SQLite (written by the bridge), build a local Next.js dashboard to browse applications / resume versions / JD archive / analytics, and compile resume LaTeX to PDF client-side with SwiftLaTeX WASM (zero server cost).

**Architecture:** A shared `lib/local/db.ts` (Node 23 built-in `node:sqlite`, no native deps) owns the schema and CRUD. The bridge persists on every `POST /output`. The Next.js App-Router dashboard reads the same `~/.applymate/app.db` in Node-runtime server components / route handlers. Resume LaTeX is compiled to PDF in the browser via a self-hosted SwiftLaTeX PdfTeX WASM engine.

**Tech Stack:** TypeScript, Node `node:sqlite`, Next.js 14 (App Router), React, Tailwind, SwiftLaTeX (`PdfTeXEngine` WASM, self-hosted), Vitest.

## Global Constraints

- `node:sqlite` is built into Node 23 (works without flags; emits an experimental warning). Do not add `better-sqlite3`.
- Single DB write path: the **bridge** writes; the dashboard only reads. The skill/extension never write SQLite directly.
- PDF compilation is client-side (browser) via SwiftLaTeX WASM. No server-side LaTeX. If the WASM engine fails to load, the dashboard falls back to showing/downloading the `.tex`.
- DB path: `~/.applymate/app.db` (override with `APPLYMATE_DB_PATH` for tests → use a temp file).
- Reuse Phase 2 `ApplyJobOutput` / `RewritingReport` shapes. The bridge POST payload is extended with `company` and `jobTitle` (the skill already has them).
- Resume bullet wording: this phase delivers **SwiftLaTeX** (not Tectonic). Update the resume claim to "client-side LaTeX→PDF via WASM" (Task 4.9).
- TDD: failing test → minimal implementation → passing test → commit.

## Prerequisites

- [ ] New branch off `main`: `git checkout -b phase-4-dashboard`.

---

## FILE STRUCTURE

```
lib/local/
├── db.ts                           # NEW — node:sqlite schema + CRUD (shared)
└── latex-wasm.ts                   # NEW — SwiftLaTeX browser compile wrapper

packages/bridge/src/
├── persist.ts                      # NEW — map StoredOutput -> DB rows
└── server.ts                       # MODIFY — call persist on POST

packages/dashboard/                 # NEW — Next.js App Router
├── package.json
├── next.config.mjs
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── app/
│   ├── layout.tsx
│   ├── globals.css
│   ├── page.tsx                    # redirect -> /applications
│   ├── applications/
│   │   ├── page.tsx                # board (list + filter)
│   │   └── [id]/page.tsx           # detail: versions + form responses
│   ├── resumes/[id]/page.tsx       # version detail: diff + PDF compile
│   ├── jd-archive/page.tsx         # searchable JD list
│   └── analytics/page.tsx          # counts + rates + top keywords
├── lib/
│   └── data.ts                     # server-only DB read helpers
└── components/
    ├── StatusBadge.tsx
    ├── BulletDiff.tsx
    └── PdfCompiler.tsx             # client component using latex-wasm
└── public/swiftlatex/             # self-hosted WASM + glue (Task 4.6)

tests/dashboard/
├── db.test.ts                      # node:sqlite CRUD
└── persist.test.ts                 # bridge persistence mapping
```

---

## Task 4.1: Shared SQLite DB Layer

**Files:**
- Create: `lib/local/db.ts`
- Create: `tests/dashboard/db.test.ts`
- Create: `packages/dashboard/package.json` (minimal, for the test runner + filter)
- Create: `packages/dashboard/vitest.config.ts`
- Create: `packages/dashboard/tsconfig.json`

**Interfaces:**
- Consumes: `node:sqlite`
- Produces: `openDb(path?)`, `migrate(db)`, `insertApplication`, `insertResumeVersion`, `insertJobDescription`, `listApplications`, `getApplication`, `listVersions`, `getVersion`, `searchJobDescriptions`, `analytics`

- [ ] **Step 1: Create packages/dashboard/package.json**

```json
{
  "name": "@applymate/dashboard",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev -p 3001",
    "build": "next build",
    "start": "next start -p 3001",
    "test": "vitest run",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

- [ ] **Step 2: Create packages/dashboard/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "skipLibCheck": true,
    "esModuleInterop": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "resolveJsonModule": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "types": ["node"]
  },
  "include": ["**/*.ts", "**/*.tsx", "../../lib/local"],
  "exclude": ["node_modules", ".next"]
}
```

- [ ] **Step 3: Create packages/dashboard/vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["../../tests/dashboard/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Write failing test tests/dashboard/db.test.ts**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import {
  openDb,
  migrate,
  insertApplication,
  insertResumeVersion,
  insertJobDescription,
  listApplications,
  getApplication,
  listVersions,
  searchJobDescriptions,
  analytics,
  type Db,
} from "../../lib/local/db";

let db: Db;
const path = join(tmpdir(), `applymate-test-${Date.now()}.db`);

beforeEach(() => {
  try {
    rmSync(path);
  } catch {
    /* ignore */
  }
  db = openDb(path);
  migrate(db);
});

describe("db", () => {
  it("inserts and lists an application", () => {
    insertApplication(db, {
      id: "a1",
      company: "Acme",
      jobTitle: "Rust Eng",
      jobUrl: "https://x/job",
      status: "submitted",
    });
    const apps = listApplications(db);
    expect(apps).toHaveLength(1);
    expect(apps[0].company).toBe("Acme");
  });

  it("stores resume versions under an application", () => {
    insertApplication(db, {
      id: "a1",
      company: "Acme",
      jobTitle: "Rust Eng",
      jobUrl: "u",
      status: "drafted",
    });
    insertResumeVersion(db, {
      id: "v1",
      applicationId: "a1",
      versionNumber: 1,
      latex: "\\item A",
      overallConfidence: 0.9,
      report: { perBullet: [] },
    });
    const versions = listVersions(db, "a1");
    expect(versions).toHaveLength(1);
    expect(versions[0].latex).toContain("item A");
  });

  it("searches job descriptions by keyword", () => {
    insertApplication(db, {
      id: "a1",
      company: "Acme",
      jobTitle: "Rust Eng",
      jobUrl: "u",
      status: "drafted",
    });
    insertJobDescription(db, {
      id: "j1",
      applicationId: "a1",
      company: "Acme",
      jobTitle: "Rust Eng",
      jdText: "We need async Rust and pgvector experience.",
    });
    expect(searchJobDescriptions(db, "pgvector")).toHaveLength(1);
    expect(searchJobDescriptions(db, "kubernetes")).toHaveLength(0);
  });

  it("reports analytics counts by status", () => {
    insertApplication(db, { id: "a1", company: "A", jobTitle: "x", jobUrl: "u", status: "submitted" });
    insertApplication(db, { id: "a2", company: "B", jobTitle: "y", jobUrl: "u", status: "interviewed" });
    const stats = analytics(db);
    expect(stats.total).toBe(2);
    expect(stats.byStatus.submitted).toBe(1);
    expect(stats.byStatus.interviewed).toBe(1);
  });

  it("getApplication returns null for a missing id", () => {
    expect(getApplication(db, "nope")).toBeNull();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm install && pnpm --filter @applymate/dashboard test db`
Expected: FAIL (module not found).

- [ ] **Step 6: Create lib/local/db.ts**

```typescript
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export type Db = DatabaseSync;

export function defaultDbPath(): string {
  return process.env.APPLYMATE_DB_PATH ?? join(homedir(), ".applymate", "app.db");
}

export function openDb(path: string = defaultDbPath()): Db {
  if (path !== ":memory:") {
    mkdirSync(join(path, ".."), { recursive: true });
  }
  return new DatabaseSync(path);
}

export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      company TEXT NOT NULL,
      job_title TEXT NOT NULL,
      job_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'drafted',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS resume_versions (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      latex TEXT NOT NULL,
      overall_confidence REAL NOT NULL,
      report_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (application_id) REFERENCES applications(id)
    );
    CREATE TABLE IF NOT EXISTS job_descriptions (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      company TEXT NOT NULL,
      job_title TEXT NOT NULL,
      jd_text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (application_id) REFERENCES applications(id)
    );
  `);
}

export interface ApplicationRow {
  id: string;
  company: string;
  jobTitle: string;
  jobUrl: string;
  status: string;
  createdAt?: string;
}

export function insertApplication(db: Db, a: ApplicationRow): void {
  db.prepare(
    `INSERT INTO applications (id, company, job_title, job_url, status)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       company=excluded.company, job_title=excluded.job_title,
       job_url=excluded.job_url, status=excluded.status,
       updated_at=datetime('now')`,
  ).run(a.id, a.company, a.jobTitle, a.jobUrl, a.status);
}

export interface ResumeVersionInput {
  id: string;
  applicationId: string;
  versionNumber: number;
  latex: string;
  overallConfidence: number;
  report: unknown;
}

export function insertResumeVersion(db: Db, v: ResumeVersionInput): void {
  db.prepare(
    `INSERT INTO resume_versions
       (id, application_id, version_number, latex, overall_confidence, report_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    v.id,
    v.applicationId,
    v.versionNumber,
    v.latex,
    v.overallConfidence,
    JSON.stringify(v.report),
  );
}

export interface JobDescriptionInput {
  id: string;
  applicationId: string;
  company: string;
  jobTitle: string;
  jdText: string;
}

export function insertJobDescription(db: Db, j: JobDescriptionInput): void {
  db.prepare(
    `INSERT INTO job_descriptions (id, application_id, company, job_title, jd_text)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(j.id, j.applicationId, j.company, j.jobTitle, j.jdText);
}

export function listApplications(db: Db): ApplicationRow[] {
  const rows = db
    .prepare(
      `SELECT id, company, job_title AS jobTitle, job_url AS jobUrl, status, created_at AS createdAt
       FROM applications ORDER BY created_at DESC`,
    )
    .all();
  return rows as unknown as ApplicationRow[];
}

export function getApplication(db: Db, id: string): ApplicationRow | null {
  const row = db
    .prepare(
      `SELECT id, company, job_title AS jobTitle, job_url AS jobUrl, status, created_at AS createdAt
       FROM applications WHERE id = ?`,
    )
    .get(id);
  return (row as unknown as ApplicationRow) ?? null;
}

export interface ResumeVersionRow {
  id: string;
  applicationId: string;
  versionNumber: number;
  latex: string;
  overallConfidence: number;
  report: unknown;
  createdAt: string;
}

export function listVersions(db: Db, applicationId: string): ResumeVersionRow[] {
  const rows = db
    .prepare(
      `SELECT id, application_id AS applicationId, version_number AS versionNumber,
              latex, overall_confidence AS overallConfidence, report_json AS reportJson,
              created_at AS createdAt
       FROM resume_versions WHERE application_id = ? ORDER BY version_number DESC`,
    )
    .all(applicationId) as any[];
  return rows.map((r) => ({
    id: r.id,
    applicationId: r.applicationId,
    versionNumber: r.versionNumber,
    latex: r.latex,
    overallConfidence: r.overallConfidence,
    report: JSON.parse(r.reportJson),
    createdAt: r.createdAt,
  }));
}

export function getVersion(db: Db, id: string): ResumeVersionRow | null {
  const r = db
    .prepare(
      `SELECT id, application_id AS applicationId, version_number AS versionNumber,
              latex, overall_confidence AS overallConfidence, report_json AS reportJson,
              created_at AS createdAt
       FROM resume_versions WHERE id = ?`,
    )
    .get(id) as any;
  if (!r) return null;
  return {
    id: r.id,
    applicationId: r.applicationId,
    versionNumber: r.versionNumber,
    latex: r.latex,
    overallConfidence: r.overallConfidence,
    report: JSON.parse(r.reportJson),
    createdAt: r.createdAt,
  };
}

export function searchJobDescriptions(
  db: Db,
  keyword: string,
): { id: string; company: string; jobTitle: string }[] {
  const rows = db
    .prepare(
      `SELECT id, company, job_title AS jobTitle FROM job_descriptions
       WHERE jd_text LIKE ? ORDER BY created_at DESC`,
    )
    .all(`%${keyword}%`);
  return rows as unknown as { id: string; company: string; jobTitle: string }[];
}

export interface Analytics {
  total: number;
  byStatus: Record<string, number>;
}

export function analytics(db: Db): Analytics {
  const rows = db
    .prepare(`SELECT status, COUNT(*) AS n FROM applications GROUP BY status`)
    .all() as { status: string; n: number }[];
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    byStatus[r.status] = r.n;
    total += r.n;
  }
  return { total, byStatus };
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @applymate/dashboard test db`
Expected: PASS (5 tests). An ExperimentalWarning for SQLite is expected and harmless.

- [ ] **Step 8: Commit**

```bash
git add lib/local/db.ts tests/dashboard/db.test.ts packages/dashboard/package.json packages/dashboard/tsconfig.json packages/dashboard/vitest.config.ts pnpm-lock.yaml
git commit -m "feat: add shared node:sqlite db layer with CRUD and analytics"
```

---

## Task 4.2: Bridge Persistence

**Files:**
- Create: `packages/bridge/src/persist.ts`
- Modify: `packages/bridge/src/server.ts`
- Modify: `packages/bridge/src/start.ts`
- Create: `tests/bridge/persist.test.ts`

**Interfaces:**
- Consumes: `db` layer, `StoredOutput` (+ `company`, `jobTitle`)
- Produces: `persistOutput(db, payload): { applicationId, versionId }`; server calls it on POST when a db is provided

- [ ] **Step 1: Write failing test tests/bridge/persist.test.ts**

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { openDb, migrate, listApplications, listVersions, type Db } from "../../lib/local/db";
import { persistOutput } from "../../packages/bridge/src/persist";

let db: Db;
const path = join(tmpdir(), `applymate-persist-${Date.now()}.db`);

beforeEach(() => {
  try {
    rmSync(path);
  } catch {
    /* ignore */
  }
  db = openDb(path);
  migrate(db);
});

describe("persistOutput", () => {
  it("creates an application, version, and JD row", () => {
    const { applicationId } = persistOutput(db, {
      jobUrl: "https://x.com/job",
      company: "Acme",
      jobTitle: "Rust Eng",
      resumeLatex: "\\item Built async Rust",
      coverLetter: "Dear Acme",
      parsedJD: { keywords: ["rust"] },
      rewritingReport: { overallConfidence: 0.93, perBullet: [] },
    } as any);

    expect(listApplications(db)).toHaveLength(1);
    expect(listVersions(db, applicationId)).toHaveLength(1);
  });

  it("bumps version number on repeated posts for the same job", () => {
    const payload = {
      jobUrl: "https://x.com/job",
      company: "Acme",
      jobTitle: "Rust Eng",
      resumeLatex: "\\item v",
      rewritingReport: { overallConfidence: 0.9, perBullet: [] },
    } as any;
    const first = persistOutput(db, payload);
    const second = persistOutput(db, payload);
    expect(first.applicationId).toBe(second.applicationId);
    const versions = listVersions(db, first.applicationId);
    expect(versions.map((v) => v.versionNumber).sort()).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @applymate/bridge test persist`
Expected: FAIL (module not found). (Add the test glob: ensure bridge `vitest.config.ts` includes `../../tests/bridge/**/*.test.ts` — it already does.)

- [ ] **Step 3: Create packages/bridge/src/persist.ts**

```typescript
import { randomUUID } from "node:crypto";
import {
  insertApplication,
  insertResumeVersion,
  insertJobDescription,
  listVersions,
  type Db,
} from "../../../lib/local/db";

export interface PersistPayload {
  jobUrl: string;
  company?: string;
  jobTitle?: string;
  resumeLatex?: string;
  coverLetter?: string;
  parsedJD?: { keywords?: string[] } & Record<string, unknown>;
  rewritingReport?: { overallConfidence?: number; perBullet?: unknown[] };
  jobDescription?: string;
}

export function persistOutput(
  db: Db,
  payload: PersistPayload,
): { applicationId: string; versionId: string } {
  const applicationId = deterministicAppId(payload.jobUrl);

  insertApplication(db, {
    id: applicationId,
    company: payload.company ?? "Unknown",
    jobTitle: payload.jobTitle ?? "Unknown",
    jobUrl: payload.jobUrl,
    status: "drafted",
  });

  const versionNumber = listVersions(db, applicationId).length + 1;
  const versionId = randomUUID();
  insertResumeVersion(db, {
    id: versionId,
    applicationId,
    versionNumber,
    latex: payload.resumeLatex ?? "",
    overallConfidence: payload.rewritingReport?.overallConfidence ?? 0,
    report: payload.rewritingReport ?? { perBullet: [] },
  });

  if (payload.jobDescription) {
    insertJobDescription(db, {
      id: randomUUID(),
      applicationId,
      company: payload.company ?? "Unknown",
      jobTitle: payload.jobTitle ?? "Unknown",
      jdText: payload.jobDescription,
    });
  }

  return { applicationId, versionId };
}

function deterministicAppId(jobUrl: string): string {
  // Stable id per job URL so repeated tailorings group as versions.
  let hash = 0;
  for (let i = 0; i < jobUrl.length; i++) {
    hash = (hash * 31 + jobUrl.charCodeAt(i)) | 0;
  }
  return `app_${(hash >>> 0).toString(16)}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @applymate/bridge test persist`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire persistence into the server**

In `packages/bridge/src/server.ts`, extend `ServerOptions` and call `persistOutput` on a successful POST. Change the `ServerOptions` interface and the POST handler:

```typescript
import type { Db } from "../../../lib/local/db";
import { persistOutput } from "./persist";

export interface ServerOptions {
  token?: string;
  db?: Db; // when provided, persist each posted output
}
```

In the POST `/output` handler, after `store.set(parsed);` add:
```typescript
          if (options.db) {
            try {
              persistOutput(options.db, parsed);
            } catch (err) {
              console.error("[ApplyMate] persist failed:", err);
            }
          }
```

- [ ] **Step 6: Open the DB in start.ts**

In `packages/bridge/src/start.ts`, open + migrate the DB and pass it to `createServer`:
```typescript
import { openDb, migrate } from "../../../lib/local/db";

const db = openDb();
migrate(db);
const server = createServer(store, { token, db });
```
(Place these lines after the `store` is constructed and before `server.listen`.)

- [ ] **Step 7: Run the full bridge suite + type-check**

Run: `pnpm --filter @applymate/bridge test && pnpm --filter @applymate/bridge type-check`
Expected: all pass, no type errors.

- [ ] **Step 8: Commit**

```bash
git add packages/bridge/src/persist.ts packages/bridge/src/server.ts packages/bridge/src/start.ts tests/bridge/persist.test.ts
git commit -m "feat: persist applications and resume versions from the bridge"
```

---

## Task 4.3: Dashboard Scaffold + Data Layer

**Files:**
- Create: `packages/dashboard/next.config.mjs`
- Create: `packages/dashboard/postcss.config.mjs`
- Create: `packages/dashboard/tailwind.config.ts`
- Create: `packages/dashboard/app/globals.css`
- Create: `packages/dashboard/app/layout.tsx`
- Create: `packages/dashboard/app/page.tsx`
- Create: `packages/dashboard/lib/data.ts`

**Interfaces:**
- Consumes: `db` layer
- Produces: a running Next.js app at `:3001`; `getApplications()`, `getApplicationDetail(id)` server helpers

- [ ] **Step 1: Create next.config.mjs**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  // node:sqlite is a built-in; keep it external to the server bundle.
  serverExternalPackages: ["node:sqlite"],
};
export default nextConfig;
```

- [ ] **Step 2: Create postcss.config.mjs**

```javascript
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

- [ ] **Step 3: Create tailwind.config.ts**

```typescript
import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 4: Create app/globals.css**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 5: Create app/layout.tsx**

```tsx
import "./globals.css";
import Link from "next/link";

export const metadata = { title: "ApplyMate Dashboard" };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900">
        <nav className="bg-white border-b px-4 py-3 flex gap-4 text-sm font-medium">
          <Link href="/applications">Applications</Link>
          <Link href="/jd-archive">JD Archive</Link>
          <Link href="/analytics">Analytics</Link>
        </nav>
        <main className="max-w-4xl mx-auto p-4">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 6: Create app/page.tsx**

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/applications");
}
```

- [ ] **Step 7: Create lib/data.ts**

```typescript
import "server-only";
import {
  openDb,
  migrate,
  listApplications,
  getApplication,
  listVersions,
  getVersion,
  searchJobDescriptions,
  analytics,
} from "../../../lib/local/db";

function db() {
  const d = openDb();
  migrate(d);
  return d;
}

export function getApplications() {
  return listApplications(db());
}

export function getApplicationDetail(id: string) {
  const d = db();
  const app = getApplication(d, id);
  if (!app) return null;
  return { app, versions: listVersions(d, id) };
}

export function getVersionDetail(id: string) {
  return getVersion(db(), id);
}

export function searchJDs(keyword: string) {
  return keyword ? searchJobDescriptions(db(), keyword) : [];
}

export function getAnalytics() {
  return analytics(db());
}
```

- [ ] **Step 8: Install + verify dev server boots**

Run:
```bash
pnpm install
pnpm --filter @applymate/dashboard build
```
Expected: Next build succeeds (pages compile). A missing-route warning for `/applications` is fine until Task 4.4.

- [ ] **Step 9: Commit**

```bash
git add packages/dashboard/next.config.mjs packages/dashboard/postcss.config.mjs packages/dashboard/tailwind.config.ts packages/dashboard/app/globals.css packages/dashboard/app/layout.tsx packages/dashboard/app/page.tsx packages/dashboard/lib/data.ts pnpm-lock.yaml
git commit -m "feat: scaffold Next.js dashboard with server-only data layer"
```

---

## Task 4.4: Applications Board

**Files:**
- Create: `packages/dashboard/components/StatusBadge.tsx`
- Create: `packages/dashboard/app/applications/page.tsx`
- Create: `packages/dashboard/app/applications/[id]/page.tsx`

**Interfaces:**
- Consumes: `getApplications`, `getApplicationDetail`
- Produces: board list + per-application detail pages (Node runtime)

- [ ] **Step 1: Create components/StatusBadge.tsx**

```tsx
const COLORS: Record<string, string> = {
  drafted: "bg-gray-200 text-gray-800",
  reviewing: "bg-yellow-200 text-yellow-900",
  submitted: "bg-blue-200 text-blue-900",
  interviewed: "bg-green-200 text-green-900",
  rejected: "bg-red-200 text-red-900",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs ${COLORS[status] ?? COLORS.drafted}`}
    >
      {status}
    </span>
  );
}
```

- [ ] **Step 2: Create app/applications/page.tsx**

```tsx
import Link from "next/link";
import { getApplications } from "../../lib/data";
import { StatusBadge } from "../../components/StatusBadge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function ApplicationsPage() {
  const apps = getApplications();
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">Applications</h1>
      {apps.length === 0 && (
        <p className="text-sm text-gray-500">
          No applications yet. Run <code>/apply-to-job</code> with the bridge
          running.
        </p>
      )}
      <ul className="divide-y bg-white rounded border">
        {apps.map((a) => (
          <li key={a.id} className="p-3 flex items-center justify-between">
            <Link href={`/applications/${a.id}`} className="hover:underline">
              <span className="font-medium">{a.jobTitle}</span>
              <span className="text-gray-500"> — {a.company}</span>
            </Link>
            <StatusBadge status={a.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Create app/applications/[id]/page.tsx**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { getApplicationDetail } from "../../../lib/data";
import { StatusBadge } from "../../../components/StatusBadge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function ApplicationDetail({
  params,
}: {
  params: { id: string };
}) {
  const detail = getApplicationDetail(params.id);
  if (!detail) notFound();
  const { app, versions } = detail;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">
          {app.jobTitle} — {app.company}
        </h1>
        <StatusBadge status={app.status} />
      </div>
      <a
        href={app.jobUrl}
        className="text-sm text-blue-600 hover:underline"
        target="_blank"
        rel="noreferrer"
      >
        {app.jobUrl}
      </a>

      <h2 className="text-lg font-medium">Resume Versions</h2>
      <ul className="divide-y bg-white rounded border">
        {versions.map((v) => (
          <li key={v.id} className="p-3 flex items-center justify-between">
            <Link href={`/resumes/${v.id}`} className="hover:underline">
              Version {v.versionNumber}
            </Link>
            <span className="text-xs text-gray-500">
              {Math.round(v.overallConfidence * 100)}% confidence
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Build to verify**

Run: `pnpm --filter @applymate/dashboard build`
Expected: build succeeds, `/applications` and `/applications/[id]` compile.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/components/StatusBadge.tsx packages/dashboard/app/applications/
git commit -m "feat: applications board and detail pages"
```

---

## Task 4.5: Resume Version Detail + Bullet Diff

**Files:**
- Create: `packages/dashboard/components/BulletDiff.tsx`
- Create: `packages/dashboard/app/resumes/[id]/page.tsx`

**Interfaces:**
- Consumes: `getVersionDetail`
- Produces: version page showing per-bullet original→revised diff, confidence, warnings, and the raw LaTeX

- [ ] **Step 1: Create components/BulletDiff.tsx**

```tsx
interface Bullet {
  original: string;
  revised: string;
  plausibilityScore: number;
  invariantChecksPassed: boolean;
  warnings: string[];
}

export function BulletDiff({ bullets }: { bullets: Bullet[] }) {
  return (
    <div className="space-y-2">
      {bullets.map((b, i) => (
        <div key={i} className="border rounded p-2 text-sm space-y-1 bg-white">
          <div className="text-red-700 line-through">{b.original}</div>
          <div className="text-green-800">{b.revised}</div>
          <div
            className={
              b.plausibilityScore < 0.7 ? "text-red-600" : "text-gray-500"
            }
          >
            {Math.round(b.plausibilityScore * 100)}% confidence
            {b.invariantChecksPassed ? "" : " — invariant failed"}
          </div>
          {b.warnings.map((w, j) => (
            <div key={j} className="text-red-600 text-xs">
              ⚠️ {w}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create app/resumes/[id]/page.tsx**

```tsx
import { notFound } from "next/navigation";
import { getVersionDetail } from "../../../lib/data";
import { BulletDiff } from "../../../components/BulletDiff";
import { PdfCompiler } from "../../../components/PdfCompiler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function ResumeVersionPage({
  params,
}: {
  params: { id: string };
}) {
  const version = getVersionDetail(params.id);
  if (!version) notFound();
  const report = version.report as {
    perBullet?: {
      original: string;
      revised: string;
      plausibilityScore: number;
      invariantChecksPassed: boolean;
      warnings: string[];
    }[];
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Resume Version {version.versionNumber}</h1>
      <div className="text-sm text-gray-500">
        {Math.round(version.overallConfidence * 100)}% overall confidence
      </div>

      <h2 className="text-lg font-medium">Bullet Changes</h2>
      <BulletDiff bullets={report.perBullet ?? []} />

      <h2 className="text-lg font-medium">PDF</h2>
      <PdfCompiler latex={version.latex} />

      <details>
        <summary className="text-sm cursor-pointer">Raw LaTeX</summary>
        <pre className="text-xs bg-white border rounded p-2 overflow-x-auto whitespace-pre-wrap">
          {version.latex}
        </pre>
      </details>
    </div>
  );
}
```

- [ ] **Step 3: Build (will fail until PdfCompiler exists — that is Task 4.6). Temporary stub:**

Create a placeholder `packages/dashboard/components/PdfCompiler.tsx` so this task builds; Task 4.6 replaces it:
```tsx
"use client";
export function PdfCompiler({ latex }: { latex: string }) {
  return (
    <div className="text-xs text-gray-500">
      PDF compiler loads in Task 4.6. ({latex.length} chars of LaTeX)
    </div>
  );
}
```

- [ ] **Step 4: Build to verify**

Run: `pnpm --filter @applymate/dashboard build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/components/BulletDiff.tsx packages/dashboard/components/PdfCompiler.tsx packages/dashboard/app/resumes/
git commit -m "feat: resume version detail with bullet diff (PDF compiler stub)"
```

---

## Task 4.6: SwiftLaTeX WASM Client-Side PDF

**Files:**
- Create: `lib/local/latex-wasm.ts`
- Create: `packages/dashboard/public/swiftlatex/` (vendored engine assets)
- Replace: `packages/dashboard/components/PdfCompiler.tsx`

**Interfaces:**
- Consumes: SwiftLaTeX `PdfTeXEngine`
- Produces: `compileInBrowser(latex): Promise<Blob>`; a client component that compiles + previews the PDF

**Note:** SwiftLaTeX ships `PdfTeXEngine.js` + `swiftlatexpdftex.wasm`. Vendor both into `public/swiftlatex/`. The engine spawns a worker that fetches the wasm by relative URL.

- [ ] **Step 1: Vendor the SwiftLaTeX engine assets**

Download the published engine bundle into the dashboard's public dir:
```bash
mkdir -p packages/dashboard/public/swiftlatex
cd packages/dashboard/public/swiftlatex
curl -L -o PdfTeXEngine.js https://raw.githubusercontent.com/SwiftLaTeX/SwiftLaTeX/master/PdfTeXEngine.js
curl -L -o swiftlatexpdftex.js https://www.swiftlatex.com/swiftlatexpdftex.js
curl -L -o swiftlatexpdftex.wasm https://www.swiftlatex.com/swiftlatexpdftex.wasm
```
Verify all three files are non-empty (`ls -la`). If a URL 404s, source the matching `PdfTeXEngine.js`, `swiftlatexpdftex.js`, and `swiftlatexpdftex.wasm` from the SwiftLaTeX repo/releases and place them here; the wrapper in Step 3 only needs these three files co-located.

- [ ] **Step 2: Create lib/local/latex-wasm.ts**

```typescript
// Browser-only wrapper around the SwiftLaTeX PdfTeX engine. The engine and its
// .wasm are self-hosted under /swiftlatex, so compilation is fully client-side
// (zero server cost).
export interface PdfEngine {
  loadEngine(): Promise<void>;
  writeMemFSFile(name: string, content: string): void;
  setEngineMainFile(name: string): void;
  compileLaTeX(): Promise<{ status: number; pdf?: Uint8Array; log: string }>;
  closeWorker(): void;
}

declare global {
  interface Window {
    PdfTeXEngine?: new () => PdfEngine;
  }
}

async function loadEngineScript(): Promise<new () => PdfEngine> {
  if (window.PdfTeXEngine) return window.PdfTeXEngine;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/swiftlatex/PdfTeXEngine.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("failed to load PdfTeXEngine.js"));
    document.head.appendChild(s);
  });
  if (!window.PdfTeXEngine) throw new Error("PdfTeXEngine not found on window");
  return window.PdfTeXEngine;
}

export async function compileInBrowser(latex: string): Promise<Blob> {
  const Engine = await loadEngineScript();
  const engine = new Engine();
  await engine.loadEngine();
  engine.writeMemFSFile("main.tex", latex);
  engine.setEngineMainFile("main.tex");
  const result = await engine.compileLaTeX();
  engine.closeWorker();
  if (result.status !== 0 || !result.pdf) {
    throw new Error(`LaTeX compile failed:\n${result.log.slice(-2000)}`);
  }
  return new Blob([result.pdf], { type: "application/pdf" });
}
```

- [ ] **Step 3: Replace components/PdfCompiler.tsx**

```tsx
"use client";
import { useState } from "react";
import { compileInBrowser } from "../../../lib/local/latex-wasm";

export function PdfCompiler({ latex }: { latex: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function compile() {
    setBusy(true);
    setError(null);
    try {
      const blob = await compileInBrowser(latex);
      setUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
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
        {busy ? "Compiling…" : "Compile PDF (client-side)"}
      </button>

      {error && (
        <pre className="text-xs text-red-600 whitespace-pre-wrap">{error}</pre>
      )}

      {url && (
        <div className="space-y-1">
          <a href={url} download="resume.pdf" className="text-sm text-blue-600">
            Download PDF
          </a>
          <iframe src={url} className="w-full h-96 border rounded" title="resume pdf" />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Manual verification (browser)**

Run:
```bash
pnpm skill:db:up    # not needed; ignore
pnpm bridge          # in one terminal, to have data (optional)
pnpm --filter @applymate/dashboard dev
```
Open `http://localhost:3001/resumes/<id>` for a real version (or seed one via the bridge), click **Compile PDF**, confirm a PDF renders in the iframe. If the engine assets fail to load, the error box shows the reason and the Raw LaTeX section still lets you download the `.tex`.

- [ ] **Step 5: Commit**

```bash
git add lib/local/latex-wasm.ts packages/dashboard/components/PdfCompiler.tsx packages/dashboard/public/swiftlatex/
git commit -m "feat: client-side LaTeX to PDF via self-hosted SwiftLaTeX WASM"
```

---

## Task 4.7: JD Archive

**Files:**
- Create: `packages/dashboard/app/jd-archive/page.tsx`

**Interfaces:**
- Consumes: `searchJDs`
- Produces: a searchable JD list (query via `?q=`)

- [ ] **Step 1: Create app/jd-archive/page.tsx**

```tsx
import { searchJDs } from "../../lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function JdArchivePage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const q = searchParams.q ?? "";
  const results = searchJDs(q);

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">JD Archive</h1>
      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="search job descriptions…"
          className="flex-1 border rounded px-2 py-1 text-sm"
        />
        <button className="bg-blue-600 text-white px-3 rounded text-sm">
          Search
        </button>
      </form>
      {q && (
        <p className="text-xs text-gray-500">
          {results.length} match(es) for “{q}”.
        </p>
      )}
      <ul className="divide-y bg-white rounded border">
        {results.map((r) => (
          <li key={r.id} className="p-3 text-sm">
            <span className="font-medium">{r.jobTitle}</span>
            <span className="text-gray-500"> — {r.company}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Build to verify**

Run: `pnpm --filter @applymate/dashboard build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/app/jd-archive/
git commit -m "feat: searchable JD archive page"
```

---

## Task 4.8: Analytics

**Files:**
- Create: `packages/dashboard/app/analytics/page.tsx`

**Interfaces:**
- Consumes: `getAnalytics`
- Produces: totals + status breakdown + submit→interview rate

- [ ] **Step 1: Create app/analytics/page.tsx**

```tsx
import { getAnalytics } from "../../lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function AnalyticsPage() {
  const stats = getAnalytics();
  const submitted = stats.byStatus.submitted ?? 0;
  const interviewed = stats.byStatus.interviewed ?? 0;
  const rate =
    submitted + interviewed > 0
      ? Math.round((interviewed / (submitted + interviewed)) * 100)
      : 0;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Analytics</h1>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Total applications" value={String(stats.total)} />
        <Stat label="Interview rate" value={`${rate}%`} />
      </div>
      <h2 className="text-lg font-medium">By Status</h2>
      <ul className="bg-white rounded border divide-y">
        {Object.entries(stats.byStatus).map(([status, n]) => (
          <li key={status} className="p-2 flex justify-between text-sm">
            <span>{status}</span>
            <span className="font-medium">{n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded border p-3">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
```

- [ ] **Step 2: Build to verify**

Run: `pnpm --filter @applymate/dashboard build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/dashboard/app/analytics/
git commit -m "feat: analytics page with status breakdown and interview rate"
```

---

## Task 4.9: SKILL.md Payload + Resume Bullet Wording

**Files:**
- Modify: `packages/skill/apply-to-job.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing
- Produces: documented POST payload fields; corrected resume claim

- [ ] **Step 1: Update the bridge-publish step in apply-to-job.md**

Ensure the POST payload documented in step 7 includes `company`, `jobTitle`, and `jobDescription` alongside the `ApplyJobOutput`, so the bridge can persist a complete application:
```markdown
   The POSTed JSON must include `jobUrl`, `company`, `jobTitle`, and
   `jobDescription` in addition to the `ApplyJobOutput` fields, so the bridge
   can persist a full application + JD archive row.
```

- [ ] **Step 2: Correct the resume claim in README.md**

In the "Resume Alignment" section, change the Tectonic-WASM line to:
```markdown
✅ **Client-side LaTeX→PDF via WASM** — SwiftLaTeX PdfTeX engine, self-hosted,
zero server cost (the original "Tectonic-WASM" wording; SwiftLaTeX is the
shipped engine).
```

- [ ] **Step 3: Commit**

```bash
git add packages/skill/apply-to-job.md README.md
git commit -m "docs: document full bridge payload and correct PDF-engine wording"
```

---

## Task 4.10: Manual Approval Gate #4

**Acceptance Criteria (Phase 4 Complete):**

Automated:
```bash
pnpm --filter @applymate/dashboard test
pnpm --filter @applymate/bridge test
pnpm --filter @applymate/dashboard type-check
pnpm --filter @applymate/bridge type-check
pnpm --filter @applymate/dashboard build
```
- [ ] DB tests pass (5) and persist tests pass (2).
- [ ] Bridge full suite still green (incl. security tests).
- [ ] Dashboard type-check + build succeed.

Manual smoke (you):
- [ ] `pnpm bridge`, then POST a sample payload (with `company`, `jobTitle`, `jobDescription`, `jobUrl`, `resumeLatex`, `rewritingReport`). Confirm a row appears.
- [ ] `pnpm --filter @applymate/dashboard dev` → `http://localhost:3001`.
  - [ ] Applications board lists the application.
  - [ ] Detail shows resume versions; a second POST for the same `jobUrl` adds Version 2.
  - [ ] Resume version page shows the bullet diff and **compiles a PDF client-side** (SwiftLaTeX) that renders in the iframe.
  - [ ] JD archive search finds the JD by keyword.
  - [ ] Analytics shows totals + interview rate.

**Sign-off:** All green → merge `phase-4-dashboard` to `main`. Phase 4 closes the dashboard + client-side-PDF resume bullets.

---

## Self-Review

- **Spec coverage:** dashboard (4.3–4.8), SQLite persistence via bridge (4.1/4.2), resume versioning + diff (4.5), JD archive (4.7), analytics (4.8), client-side PDF via WASM (4.6). Single write path (bridge) enforced; dashboard read-only.
- **No placeholders:** every code step is complete; the PdfCompiler stub in 4.5 is explicitly replaced in 4.6.
- **Type consistency:** `Db`, `ApplicationRow`, `ResumeVersionRow` defined in 4.1 and consumed unchanged in 4.2/data.ts. `persistOutput` signature matches its test and the server call site. `report.perBullet` shape matches the Phase 2 `BulletRewrite` fields used by `BulletDiff`.
- **Known risk:** SwiftLaTeX asset URLs (4.6 Step 1) may move; the step documents sourcing the three files from the repo as fallback, and the UI degrades to LaTeX download if the engine fails to load. node:sqlite emits an experimental warning (harmless).
```
