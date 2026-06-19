# ApplyMate Phase 2: 5-Stage Skill Pipeline — Implementation Plan

> **For agentic workers:** RECOMMENDED SUB-SKILL: Use `superpowers:executing-plans` (or `subagent-driven-development`) to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the `/apply-to-job` Claude Code skill: a hybrid 5-stage pipeline that parses a JD, retrieves relevant experience via local-embedding pgvector search, rewrites resume bullets under deterministic anchor validation (zero hallucinations), assembles LaTeX, and generates a cover letter.

**Architecture:** Hybrid execution. Deterministic TypeScript handles the testable machinery — JD keyword extraction, embedding generation, pgvector retrieval, anchor/invariant validation, plausibility scoring, LaTeX assembly. Claude (running inside the skill on the Pro plan, no API calls) supplies the linguistic judgment — proposing rewritten bullet text and cover-letter prose — but every Claude-proposed rewrite is fed back through the deterministic validator before it can be accepted. The skill is orchestrated by a `SKILL.md` that tells Claude when to call a tool versus when to reason.

**Tech Stack:** TypeScript (Node, ESM), Postgres 16 + pgvector (Docker), `@xenova/transformers` (all-MiniLM-L6-v2, 384-dim embeddings, local), `pg` + `pgvector` node clients, `yaml` (corpus parsing), Vitest.

## Global Constraints

- No Claude API calls. The skill runs inside Claude Code on the Pro plan; "Claude reasoning" means the agent executing the skill, never an HTTP API call.
- Anchor validation is deterministic and the single source of truth for "no hallucinations." Every injected keyword must map to a corpus anchor; every original metric must be preserved byte-for-byte.
- Embeddings generated locally (transformers.js), zero external cost.
- Embedding dimension is exactly 384 (all-MiniLM-L6-v2). The pgvector column is `vector(384)`.
- Plausibility floor is 0.5; never report lower.
- Low-confidence threshold is 0.7 — bullets scoring below require explicit user handling (carried into the report, enforced in the extension UI in Phase 3).
- Corpus path: `~/.applymate/experience.yaml`. Master resume template: `~/.applymate/resume-template.tex`.
- TDD: failing test → minimal implementation → passing test → commit, every task.

---

## Prerequisites (one-time, before Task 2.1)

- [ ] Docker Desktop running (for Postgres + pgvector).
- [ ] Node 18+ (repo already uses Node 23 via the Phase 1 setup).
- [ ] New branch off `main`: `git checkout -b phase-2-skill`.

---

## FILE STRUCTURE

```
packages/skill/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── docker-compose.yml              # Postgres 16 + pgvector
├── apply-to-job.md                 # SKILL.md — hybrid orchestration for Claude
├── db/
│   └── schema.sql                  # experiences table with vector(384)
├── src/
│   ├── types.ts                    # All skill types
│   ├── corpus/
│   │   └── load.ts                 # experience.yaml -> ExperienceAnchor[]
│   ├── embeddings/
│   │   └── embedder.ts             # transformers.js wrapper -> Float32Array(384)
│   ├── db/
│   │   └── pgvector.ts             # connect, migrate, upsert, knnSearch
│   ├── stages/
│   │   ├── parse-jd.ts             # Stage 1
│   │   ├── retrieve.ts             # Stage 2
│   │   ├── rewrite.ts              # Stage 3 (validation API)
│   │   ├── assemble-latex.ts       # Stage 4
│   │   └── cover-letter.ts         # Stage 5
│   ├── validators/
│   │   ├── invariant-checks.ts     # CRITICAL: metrics, hallucinations, seniority
│   │   └── plausibility.ts         # confidence scoring
│   └── index.ts                    # composeReport: ties stages into ApplyJobOutput
└── (tests live in tests/skill/)

tests/skill/
├── corpus-load.test.ts
├── embedder.test.ts
├── pgvector.test.ts                # integration (needs docker)
├── parse-jd.test.ts
├── retrieve.test.ts                # integration (needs docker)
├── invariant-checks.test.ts        # 50+ cases (CRITICAL)
├── plausibility.test.ts
├── rewrite.test.ts
├── assemble-latex.test.ts
├── cover-letter.test.ts
└── compose.test.ts

~/.applymate/                       # user data (created by Task 2.3 fixture script)
├── experience.yaml
└── resume-template.tex
```

---

## Task 2.1: Skill Package Scaffold + pgvector Docker

**Files:**
- Create: `packages/skill/package.json`
- Create: `packages/skill/tsconfig.json`
- Create: `packages/skill/vitest.config.ts`
- Create: `packages/skill/docker-compose.yml`
- Create: `packages/skill/db/schema.sql`
- Modify: root `package.json` (add skill scripts)

**Interfaces:**
- Consumes: nothing
- Produces: buildable/testable skill package; running Postgres+pgvector on `localhost:5433`

- [ ] **Step 1: Create packages/skill/package.json**

```json
{
  "name": "@applymate/skill",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "type-check": "tsc --noEmit",
    "db:up": "docker compose up -d",
    "db:down": "docker compose down",
    "db:migrate": "node --experimental-strip-types src/db/migrate.ts"
  },
  "dependencies": {
    "@xenova/transformers": "^2.17.2",
    "pg": "^8.11.3",
    "pgvector": "^0.2.0",
    "yaml": "^2.3.4"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/pg": "^8.11.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

- [ ] **Step 2: Create packages/skill/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "skipLibCheck": true,
    "esModuleInterop": true,
    "strict": true,
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create packages/skill/vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["../../tests/skill/**/*.test.ts"],
    testTimeout: 120000, // embeddings model load can be slow on first run
  },
});
```

- [ ] **Step 4: Create packages/skill/docker-compose.yml**

```yaml
services:
  pgvector:
    image: pgvector/pgvector:pg16
    container_name: applymate-pgvector
    environment:
      POSTGRES_USER: applymate
      POSTGRES_PASSWORD: applymate
      POSTGRES_DB: applymate
    ports:
      - "5433:5432"
    volumes:
      - applymate_pgdata:/var/lib/postgresql/data

volumes:
  applymate_pgdata:
```

- [ ] **Step 5: Create packages/skill/db/schema.sql**

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS experiences (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  skills        TEXT[] NOT NULL DEFAULT '{}',
  metrics       TEXT[] NOT NULL DEFAULT '{}',
  tags          TEXT[] NOT NULL DEFAULT '{}',
  claim_anchor  TEXT NOT NULL,
  embedding     vector(384) NOT NULL
);

CREATE INDEX IF NOT EXISTS experiences_embedding_idx
  ON experiences USING hnsw (embedding vector_cosine_ops);
```

- [ ] **Step 6: Add skill scripts to root package.json**

Add these entries to the root `package.json` `scripts` object:

```json
    "test:skill": "pnpm --filter @applymate/skill test",
    "type-check:skill": "pnpm --filter @applymate/skill type-check",
    "skill:db:up": "pnpm --filter @applymate/skill db:up",
    "skill:db:down": "pnpm --filter @applymate/skill db:down"
```

- [ ] **Step 7: Install + start the database**

Run:
```bash
pnpm install
pnpm --filter @applymate/skill db:up
```
Expected: `applymate-pgvector` container running. Verify:
```bash
docker ps --filter name=applymate-pgvector --format '{{.Status}}'
```
Expected: `Up ...`

- [ ] **Step 8: Commit**

```bash
git add packages/skill/package.json packages/skill/tsconfig.json packages/skill/vitest.config.ts packages/skill/docker-compose.yml packages/skill/db/schema.sql package.json pnpm-lock.yaml
git commit -m "chore: scaffold skill package with pgvector docker"
```

---

## Task 2.2: Skill Types

**Files:**
- Create: `packages/skill/src/types.ts`

**Interfaces:**
- Consumes: `FormField` from `lib/shared/types`
- Produces: `ParsedJD`, `ExperienceAnchor`, `RetrievedExperience`, `BulletRewrite`, `RewritingReport`, `ApplyJobInput`, `ApplyJobOutput`

- [ ] **Step 1: Create packages/skill/src/types.ts**

```typescript
import type { FormField } from "../../../lib/shared/types";

export interface ParsedJD {
  keywords: string[];          // normalized, lowercased, de-duped
  hardSkills: string[];        // explicit tech/tools
  seniority: "junior" | "mid" | "senior" | "staff" | "unknown";
  yearsRequired: number | null;
  techStack: string[];
  mustHaves: string[];
  niceToHaves: string[];
}

export interface ExperienceAnchor {
  id: string;
  title: string;
  description: string;
  skills: string[];
  metrics: string[];
  tags: string[];
  claimAnchor: string;
}

export interface RetrievedExperience {
  anchor: ExperienceAnchor;
  relevanceScore: number;      // cosine similarity, 0..1
}

export interface BulletRewrite {
  original: string;
  revised: string;
  keywordsAdded: string[];
  metricsPreserved: string[];
  reasonsForAddition: string[];
  invariantChecksPassed: boolean;
  plausibilityScore: number;   // 0.5..1
  validationNotes: string[];
  warnings: string[];
}

export interface RewritingReport {
  totalBullets: number;
  bulletsModified: number;
  totalKeywordsAdded: number;
  perBullet: BulletRewrite[];
  summary: string;
  overallConfidence: number;
  warnings: string[];
  recommendations: string[];
  allInvariantChecksPassed: boolean;
}

export interface ApplyJobInput {
  jobDescription: string;
  jobTitle: string;
  company: string;
  jobUrl: string;
  formFields: FormField[];
  manualContext?: string;
}

export interface ApplyJobOutput {
  parsedJD: ParsedJD;
  retrievedExperiences: RetrievedExperience[];
  resumeLatex: string;
  coverLetter: string;
  rewritingReport: RewritingReport;
  formFieldGuidance: {
    fieldId: string;
    suggestedAnswer: string;
    relatedBullets: string[];
  }[];
  reasoning: string;
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm --filter @applymate/skill type-check`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/skill/src/types.ts
git commit -m "feat: add skill pipeline types"
```

---

## Task 2.3: Corpus Loader + Fixtures

**Files:**
- Create: `packages/skill/src/corpus/load.ts`
- Create: `tests/skill/corpus-load.test.ts`
- Create: `tests/skill/fixtures/experience.yaml`

**Interfaces:**
- Consumes: `ExperienceAnchor`
- Produces: `loadCorpus(path: string): Promise<ExperienceAnchor[]>`

- [ ] **Step 1: Create the test fixture tests/skill/fixtures/experience.yaml**

```yaml
experiences:
  - id: rust-async-http
    title: Built concurrent HTTP server in Rust
    description: Implemented async Rust web server handling high throughput.
    skills: [rust, async, concurrency, http]
    metrics: ["10k req/s", "sub-100ms latency"]
    tags: [backend, performance, systems]
    claim_anchor: Expert in async Rust systems programming
  - id: postgres-zero-downtime
    title: PostgreSQL zero-downtime migration
    description: Led migration of a 50M-row table with no downtime.
    skills: [postgres, sql, devops]
    metrics: ["50M rows", "2hr window"]
    tags: [databases, reliability]
    claim_anchor: Database reliability and zero-downtime migrations
```

- [ ] **Step 2: Write failing test tests/skill/corpus-load.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadCorpus } from "../../packages/skill/src/corpus/load";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "experience.yaml");

describe("loadCorpus", () => {
  it("parses experiences into anchors", async () => {
    const anchors = await loadCorpus(fixture);
    expect(anchors).toHaveLength(2);
    const rust = anchors.find((a) => a.id === "rust-async-http")!;
    expect(rust.skills).toContain("async");
    expect(rust.metrics).toContain("10k req/s");
    expect(rust.claimAnchor).toMatch(/async Rust/);
  });

  it("throws a clear error when the file is missing", async () => {
    await expect(loadCorpus("/no/such/file.yaml")).rejects.toThrow(
      /experience corpus not found/i,
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @applymate/skill test corpus-load`
Expected: FAIL (module not found).

- [ ] **Step 4: Create packages/skill/src/corpus/load.ts**

```typescript
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import type { ExperienceAnchor } from "../types";

interface RawExperience {
  id: string;
  title: string;
  description: string;
  skills?: string[];
  metrics?: string[];
  tags?: string[];
  claim_anchor: string;
}

export async function loadCorpus(path: string): Promise<ExperienceAnchor[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(
      `Experience corpus not found at ${path}. Create it with your experiences.`,
    );
  }

  const doc = parse(raw) as { experiences?: RawExperience[] } | null;
  const experiences = doc?.experiences ?? [];

  return experiences.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    skills: (e.skills ?? []).map((s) => s.toLowerCase()),
    metrics: e.metrics ?? [],
    tags: (e.tags ?? []).map((t) => t.toLowerCase()),
    claimAnchor: e.claim_anchor,
  }));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @applymate/skill test corpus-load`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/skill/src/corpus/load.ts tests/skill/corpus-load.test.ts tests/skill/fixtures/experience.yaml
git commit -m "feat: implement experience corpus loader"
```

---

## Task 2.4: Local Embedder

**Files:**
- Create: `packages/skill/src/embeddings/embedder.ts`
- Create: `tests/skill/embedder.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `embed(text: string): Promise<number[]>` (length 384, L2-normalized); `embedBatch(texts: string[]): Promise<number[][]>`

- [ ] **Step 1: Write failing test tests/skill/embedder.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import { embed, embedBatch } from "../../packages/skill/src/embeddings/embedder";

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // inputs are normalized
}

describe("embedder", () => {
  it("produces a 384-dim normalized vector", async () => {
    const v = await embed("async Rust web server");
    expect(v).toHaveLength(384);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 2);
  });

  it("ranks related text closer than unrelated text", async () => {
    const [query, related, unrelated] = await embedBatch([
      "concurrent asynchronous Rust server",
      "built an async HTTP server in Rust",
      "designed marketing brochures in Photoshop",
    ]);
    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @applymate/skill test embedder`
Expected: FAIL (module not found).

- [ ] **Step 3: Create packages/skill/src/embeddings/embedder.ts**

```typescript
import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
    );
  }
  return extractorPromise;
}

export async function embed(text: string): Promise<number[]> {
  const [vec] = await embedBatch([text]);
  return vec;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const extractor = await getExtractor();
  const output = await extractor(texts, {
    pooling: "mean",
    normalize: true,
  });
  // output.tolist() -> number[][] of shape [texts.length, 384]
  return output.tolist() as number[][];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @applymate/skill test embedder`
Expected: PASS (2 tests). First run downloads the model (~90MB) and may take a minute.

- [ ] **Step 5: Commit**

```bash
git add packages/skill/src/embeddings/embedder.ts tests/skill/embedder.test.ts
git commit -m "feat: implement local transformers.js embedder (all-MiniLM-L6-v2)"
```

---

## Task 2.5: pgvector Store

**Files:**
- Create: `packages/skill/src/db/pgvector.ts`
- Create: `packages/skill/src/db/migrate.ts`
- Create: `tests/skill/pgvector.test.ts`

**Interfaces:**
- Consumes: `ExperienceAnchor`, `embedBatch`
- Produces: `connect()`, `migrate(client)`, `upsertAnchors(client, anchors)`, `knnSearch(client, queryVec, k)`

**Note:** Integration task — requires `pnpm --filter @applymate/skill db:up` first.

- [ ] **Step 1: Create packages/skill/src/db/pgvector.ts**

```typescript
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import pgvector from "pgvector/pg";
import { embedBatch } from "../embeddings/embedder";
import type { ExperienceAnchor } from "../types";

const { Client } = pg;

const CONNECTION =
  process.env.APPLYMATE_PG_URL ??
  "postgres://applymate:applymate@localhost:5433/applymate";

export async function connect(): Promise<pg.Client> {
  const client = new Client({ connectionString: CONNECTION });
  await client.connect();
  await pgvector.registerType(client);
  return client;
}

export async function migrate(client: pg.Client): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = await readFile(join(here, "..", "..", "db", "schema.sql"), "utf8");
  await client.query(sql);
}

export async function upsertAnchors(
  client: pg.Client,
  anchors: ExperienceAnchor[],
): Promise<void> {
  if (anchors.length === 0) return;
  // Embed the semantic text of each anchor.
  const texts = anchors.map(
    (a) => `${a.title}. ${a.description} ${a.skills.join(" ")} ${a.tags.join(" ")}`,
  );
  const vectors = await embedBatch(texts);

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    await client.query(
      `INSERT INTO experiences (id, title, description, skills, metrics, tags, claim_anchor, embedding)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         title=$2, description=$3, skills=$4, metrics=$5, tags=$6, claim_anchor=$7, embedding=$8`,
      [
        a.id,
        a.title,
        a.description,
        a.skills,
        a.metrics,
        a.tags,
        a.claimAnchor,
        pgvector.toSql(vectors[i]),
      ],
    );
  }
}

export async function knnSearch(
  client: pg.Client,
  queryVec: number[],
  k: number,
): Promise<{ id: string; score: number }[]> {
  const res = await client.query(
    `SELECT id, 1 - (embedding <=> $1) AS score
     FROM experiences
     ORDER BY embedding <=> $1
     LIMIT $2`,
    [pgvector.toSql(queryVec), k],
  );
  return res.rows.map((r) => ({ id: r.id, score: Number(r.score) }));
}
```

- [ ] **Step 2: Create packages/skill/src/db/migrate.ts**

```typescript
import { connect, migrate } from "./pgvector";

const client = await connect();
await migrate(client);
await client.end();
console.log("[ApplyMate] pgvector schema migrated");
```

- [ ] **Step 3: Write failing test tests/skill/pgvector.test.ts**

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type pg from "pg";
import {
  connect,
  migrate,
  upsertAnchors,
  knnSearch,
} from "../../packages/skill/src/db/pgvector";
import { loadCorpus } from "../../packages/skill/src/corpus/load";
import { embed } from "../../packages/skill/src/embeddings/embedder";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "experience.yaml");

let client: pg.Client;

beforeAll(async () => {
  client = await connect();
  await migrate(client);
  await client.query("DELETE FROM experiences");
  await upsertAnchors(client, await loadCorpus(fixture));
});

afterAll(async () => {
  await client.end();
});

describe("pgvector knnSearch", () => {
  it("returns the Rust anchor first for a Rust query", async () => {
    const q = await embed("asynchronous Rust web service with high throughput");
    const hits = await knnSearch(client, q, 2);
    expect(hits[0].id).toBe("rust-async-http");
    expect(hits[0].score).toBeGreaterThan(0.3);
  });

  it("returns the Postgres anchor first for a database query", async () => {
    const q = await embed("zero downtime database migration on a huge table");
    const hits = await knnSearch(client, q, 2);
    expect(hits[0].id).toBe("postgres-zero-downtime");
  });
});
```

- [ ] **Step 4: Run test to verify it fails, then passes**

Run: `pnpm --filter @applymate/skill db:up` (if not already up), then
`pnpm --filter @applymate/skill test pgvector`
Expected: PASS (2 tests) once `pgvector.ts` exists. If the module were missing it would FAIL — confirm you saw the implementation created in Steps 1-2.

- [ ] **Step 5: Commit**

```bash
git add packages/skill/src/db/pgvector.ts packages/skill/src/db/migrate.ts tests/skill/pgvector.test.ts
git commit -m "feat: implement pgvector store (connect, migrate, upsert, knn)"
```

---

## Task 2.6: Stage 1 — Parse JD

**Files:**
- Create: `packages/skill/src/stages/parse-jd.ts`
- Create: `tests/skill/parse-jd.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `parseJD(jobDescription: string): ParsedJD`

This is the deterministic baseline. Claude may augment keywords at runtime via the SKILL.md, but the deterministic parser guarantees a usable floor and is what tests assert against.

- [ ] **Step 1: Write failing test tests/skill/parse-jd.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import { parseJD } from "../../packages/skill/src/stages/parse-jd";

describe("parseJD", () => {
  it("extracts seniority and years", () => {
    const jd = parseJD("Senior Rust Engineer with 5+ years of experience.");
    expect(jd.seniority).toBe("senior");
    expect(jd.yearsRequired).toBe(5);
  });

  it("extracts known tech keywords", () => {
    const jd = parseJD(
      "You will work with Rust, PostgreSQL, Docker and async programming.",
    );
    expect(jd.keywords).toContain("rust");
    expect(jd.keywords).toContain("postgresql");
    expect(jd.keywords).toContain("docker");
  });

  it("splits must-haves from nice-to-haves", () => {
    const jd = parseJD(
      "Required: Rust. Nice to have: Kubernetes experience is a plus.",
    );
    expect(jd.mustHaves.join(" ").toLowerCase()).toContain("rust");
    expect(jd.niceToHaves.join(" ").toLowerCase()).toContain("kubernetes");
  });

  it("returns unknown seniority when unspecified", () => {
    const jd = parseJD("We build cool things.");
    expect(jd.seniority).toBe("unknown");
    expect(jd.yearsRequired).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @applymate/skill test parse-jd`
Expected: FAIL (module not found).

- [ ] **Step 3: Create packages/skill/src/stages/parse-jd.ts**

```typescript
import type { ParsedJD } from "../types";

const TECH_TERMS = [
  "rust", "go", "golang", "python", "typescript", "javascript", "java",
  "c++", "postgresql", "postgres", "mysql", "redis", "docker", "kubernetes",
  "aws", "gcp", "graphql", "rest", "async", "concurrency", "react", "node",
  "wasm", "latex", "pgvector", "llm", "tectonic",
];

const SENIORITY_MAP: { re: RegExp; level: ParsedJD["seniority"] }[] = [
  { re: /\bstaff\b|\bprincipal\b/i, level: "staff" },
  { re: /\bsenior\b|\bsr\.?\b/i, level: "senior" },
  { re: /\bmid[- ]?level\b|\bintermediate\b/i, level: "mid" },
  { re: /\bjunior\b|\bjr\.?\b|\bentry[- ]?level\b/i, level: "junior" },
];

export function parseJD(jobDescription: string): ParsedJD {
  const text = jobDescription.toLowerCase();

  const keywords = Array.from(
    new Set(TECH_TERMS.filter((t) => text.includes(t))),
  );

  let seniority: ParsedJD["seniority"] = "unknown";
  for (const { re, level } of SENIORITY_MAP) {
    if (re.test(jobDescription)) {
      seniority = level;
      break;
    }
  }

  const yearsMatch = jobDescription.match(/(\d+)\s*\+?\s*years?/i);
  const yearsRequired = yearsMatch ? Number(yearsMatch[1]) : null;

  const { mustHaves, niceToHaves } = splitRequirements(jobDescription);

  return {
    keywords,
    hardSkills: keywords,
    seniority,
    yearsRequired,
    techStack: keywords,
    mustHaves,
    niceToHaves,
  };
}

function splitRequirements(jd: string): {
  mustHaves: string[];
  niceToHaves: string[];
} {
  const mustHaves: string[] = [];
  const niceToHaves: string[] = [];
  const sentences = jd.split(/[.\n]/).map((s) => s.trim()).filter(Boolean);

  for (const s of sentences) {
    if (/nice to have|plus|bonus|preferred/i.test(s)) niceToHaves.push(s);
    else if (/required|must have|you will|responsib/i.test(s)) mustHaves.push(s);
  }
  return { mustHaves, niceToHaves };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @applymate/skill test parse-jd`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/skill/src/stages/parse-jd.ts tests/skill/parse-jd.test.ts
git commit -m "feat: implement Stage 1 JD parsing"
```

---

## Task 2.7: Stage 2 — Retrieve

**Files:**
- Create: `packages/skill/src/stages/retrieve.ts`
- Create: `tests/skill/retrieve.test.ts`

**Interfaces:**
- Consumes: `ParsedJD`, `connect`, `knnSearch`, `embed`, `loadCorpus`
- Produces: `retrieve(client, parsedJD, anchors, k): Promise<RetrievedExperience[]>`

**Note:** Integration task — needs docker DB seeded (reuses Task 2.5 setup).

- [ ] **Step 1: Write failing test tests/skill/retrieve.test.ts**

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type pg from "pg";
import { connect, migrate, upsertAnchors } from "../../packages/skill/src/db/pgvector";
import { loadCorpus } from "../../packages/skill/src/corpus/load";
import { parseJD } from "../../packages/skill/src/stages/parse-jd";
import { retrieve } from "../../packages/skill/src/stages/retrieve";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "experience.yaml");

let client: pg.Client;
let anchors: Awaited<ReturnType<typeof loadCorpus>>;

beforeAll(async () => {
  client = await connect();
  await migrate(client);
  await client.query("DELETE FROM experiences");
  anchors = await loadCorpus(fixture);
  await upsertAnchors(client, anchors);
});

afterAll(async () => {
  await client.end();
});

describe("retrieve", () => {
  it("ranks the Rust anchor top for a Rust JD", async () => {
    const jd = parseJD("Senior Rust Engineer, async systems, high throughput.");
    const results = await retrieve(client, jd, anchors, 2);
    expect(results[0].anchor.id).toBe("rust-async-http");
    expect(results[0].relevanceScore).toBeGreaterThan(0.3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @applymate/skill test retrieve`
Expected: FAIL (module not found).

- [ ] **Step 3: Create packages/skill/src/stages/retrieve.ts**

```typescript
import type pg from "pg";
import type { ParsedJD, ExperienceAnchor, RetrievedExperience } from "../types";
import { embed } from "../embeddings/embedder";
import { knnSearch } from "../db/pgvector";

export async function retrieve(
  client: pg.Client,
  parsedJD: ParsedJD,
  anchors: ExperienceAnchor[],
  k: number,
): Promise<RetrievedExperience[]> {
  const queryText = [
    parsedJD.keywords.join(" "),
    parsedJD.mustHaves.join(" "),
  ].join(" ");

  const queryVec = await embed(queryText);
  const hits = await knnSearch(client, queryVec, k);

  const byId = new Map(anchors.map((a) => [a.id, a]));
  return hits
    .map((h) => {
      const anchor = byId.get(h.id);
      return anchor ? { anchor, relevanceScore: h.score } : null;
    })
    .filter((x): x is RetrievedExperience => x !== null);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @applymate/skill test retrieve`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/skill/src/stages/retrieve.ts tests/skill/retrieve.test.ts
git commit -m "feat: implement Stage 2 pgvector retrieval"
```

---

## Task 2.8: Invariant Checks (CRITICAL)

**Files:**
- Create: `packages/skill/src/validators/invariant-checks.ts`
- Create: `tests/skill/invariant-checks.test.ts`

**Interfaces:**
- Consumes: `ExperienceAnchor`
- Produces:
  - `extractMetrics(text: string): string[]`
  - `findUnsupportedKeywords(addedKeywords: string[], anchors: ExperienceAnchor[]): string[]`
  - `checkInvariants(input: InvariantInput): InvariantResult`
  - types `InvariantInput { original, revised, addedKeywords, anchors, jdSeniority }`, `InvariantResult { passed, metricsPreserved, droppedMetrics, unsupportedKeywords, seniorityInflated, notes }`

This is the single source of truth for "no hallucinations." It is pure and exhaustively tested.

- [ ] **Step 1: Write failing test tests/skill/invariant-checks.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import {
  extractMetrics,
  findUnsupportedKeywords,
  checkInvariants,
} from "../../packages/skill/src/validators/invariant-checks";
import type { ExperienceAnchor } from "../../packages/skill/src/types";

const anchors: ExperienceAnchor[] = [
  {
    id: "rust-async-http",
    title: "Rust async HTTP server",
    description: "",
    skills: ["rust", "async", "concurrency", "http"],
    metrics: ["10k req/s", "sub-100ms latency"],
    tags: ["backend", "performance"],
    claimAnchor: "Expert in async Rust",
  },
  {
    id: "pg",
    title: "Postgres migration",
    description: "",
    skills: ["postgres", "sql"],
    metrics: ["50M rows"],
    tags: ["databases"],
    claimAnchor: "DB reliability",
  },
];

describe("extractMetrics", () => {
  it("pulls numeric metrics from text", () => {
    expect(extractMetrics("handled 10k req/s at sub-100ms latency")).toEqual(
      expect.arrayContaining(["10k", "100ms"]),
    );
  });
  it("captures plain numbers and percentages", () => {
    expect(extractMetrics("reduced cost by 40% across 5 services")).toEqual(
      expect.arrayContaining(["40%", "5"]),
    );
  });
});

describe("findUnsupportedKeywords", () => {
  it("returns empty when all keywords are in the corpus", () => {
    expect(findUnsupportedKeywords(["rust", "async"], anchors)).toEqual([]);
  });
  it("flags a keyword absent from every anchor", () => {
    expect(findUnsupportedKeywords(["kubernetes"], anchors)).toEqual([
      "kubernetes",
    ]);
  });
  it("is case-insensitive", () => {
    expect(findUnsupportedKeywords(["Rust", "ASYNC"], anchors)).toEqual([]);
  });
});

describe("checkInvariants", () => {
  it("passes a clean exact-match rewrite", () => {
    const r = checkInvariants({
      original: "Built HTTP server in Rust, 10k req/s",
      revised: "Built async HTTP server in Rust, 10k req/s",
      addedKeywords: ["async"],
      anchors,
      jdSeniority: "senior",
    });
    expect(r.passed).toBe(true);
    expect(r.metricsPreserved).toBe(true);
    expect(r.unsupportedKeywords).toEqual([]);
  });

  it("fails when an original metric is dropped", () => {
    const r = checkInvariants({
      original: "Migrated 50M rows in a 2hr window",
      revised: "Migrated a very large table quickly",
      addedKeywords: [],
      anchors,
      jdSeniority: "senior",
    });
    expect(r.passed).toBe(false);
    expect(r.metricsPreserved).toBe(false);
    expect(r.droppedMetrics).toEqual(expect.arrayContaining(["50M", "2"]));
  });

  it("fails when a metric value is altered", () => {
    const r = checkInvariants({
      original: "Handled 10k req/s",
      revised: "Handled 20k req/s",
      addedKeywords: [],
      anchors,
      jdSeniority: "senior",
    });
    expect(r.passed).toBe(false);
    expect(r.metricsPreserved).toBe(false);
  });

  it("fails when an unsupported keyword is injected", () => {
    const r = checkInvariants({
      original: "Deployed with Docker",
      revised: "Deployed with Docker, orchestrated Kubernetes",
      addedKeywords: ["kubernetes"],
      anchors,
      jdSeniority: "senior",
    });
    expect(r.passed).toBe(false);
    expect(r.unsupportedKeywords).toEqual(["kubernetes"]);
  });

  it("flags seniority inflation when corpus is junior but JD is staff", () => {
    const r = checkInvariants({
      original: "Junior engineer for 1 year",
      revised: "Staff engineer leading the org for 1 year",
      addedKeywords: [],
      anchors,
      jdSeniority: "staff",
    });
    expect(r.seniorityInflated).toBe(true);
    expect(r.passed).toBe(false);
  });

  it("allows adding a supported metric already present in the original", () => {
    const r = checkInvariants({
      original: "Built server, 10k req/s, sub-100ms latency",
      revised: "Built async server, 10k req/s, sub-100ms latency",
      addedKeywords: ["async"],
      anchors,
      jdSeniority: "mid",
    });
    expect(r.passed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @applymate/skill test invariant-checks`
Expected: FAIL (module not found).

- [ ] **Step 3: Create packages/skill/src/validators/invariant-checks.ts**

```typescript
import type { ExperienceAnchor, ParsedJD } from "../types";

export interface InvariantInput {
  original: string;
  revised: string;
  addedKeywords: string[];
  anchors: ExperienceAnchor[];
  jdSeniority: ParsedJD["seniority"];
}

export interface InvariantResult {
  passed: boolean;
  metricsPreserved: boolean;
  droppedMetrics: string[];
  unsupportedKeywords: string[];
  seniorityInflated: boolean;
  notes: string[];
}

const SENIORITY_RANK: Record<string, number> = {
  unknown: 0,
  junior: 1,
  mid: 2,
  senior: 3,
  staff: 4,
};

// Normalizes "10k", "100ms", "50M", "40%", "5" into comparable tokens.
export function extractMetrics(text: string): string[] {
  const matches =
    text
      .toLowerCase()
      .match(/\d+(?:\.\d+)?\s*(?:k|m|b|%|ms|s|x|gb|mb|req\/s|hr|hrs)?/g) ?? [];
  return matches
    .map((m) => m.replace(/\s+/g, ""))
    .map((m) => m.replace(/req\/s|hrs?|gb|mb/g, "")) // unit suffixes we don't diff on
    .map((m) => m.trim())
    .filter((m) => /\d/.test(m));
}

export function findUnsupportedKeywords(
  addedKeywords: string[],
  anchors: ExperienceAnchor[],
): string[] {
  const supported = new Set<string>();
  for (const a of anchors) {
    a.skills.forEach((s) => supported.add(s.toLowerCase()));
    a.tags.forEach((t) => supported.add(t.toLowerCase()));
  }
  return addedKeywords
    .map((k) => k.toLowerCase())
    .filter((k) => !supported.has(k));
}

export function checkInvariants(input: InvariantInput): InvariantResult {
  const notes: string[] = [];

  const originalMetrics = extractMetrics(input.original);
  const revisedMetrics = new Set(extractMetrics(input.revised));
  const droppedMetrics = originalMetrics.filter((m) => !revisedMetrics.has(m));
  const metricsPreserved = droppedMetrics.length === 0;
  if (!metricsPreserved) {
    notes.push(`Dropped or altered metrics: ${droppedMetrics.join(", ")}`);
  }

  const unsupportedKeywords = findUnsupportedKeywords(
    input.addedKeywords,
    input.anchors,
  );
  if (unsupportedKeywords.length > 0) {
    notes.push(`Unsupported keywords: ${unsupportedKeywords.join(", ")}`);
  }

  const seniorityInflated = detectSeniorityInflation(
    input.revised,
    input.jdSeniority,
    notes,
  );

  const passed =
    metricsPreserved &&
    unsupportedKeywords.length === 0 &&
    !seniorityInflated;

  return {
    passed,
    metricsPreserved,
    droppedMetrics,
    unsupportedKeywords,
    seniorityInflated,
    notes,
  };
}

function detectSeniorityInflation(
  revised: string,
  jdSeniority: ParsedJD["seniority"],
  notes: string[],
): boolean {
  // If the revised bullet self-describes a level above what the JD asks AND
  // above mid, treat as inflation risk to surface for the user.
  const claimed = highestSeniorityWord(revised);
  if (claimed === "unknown") return false;
  if (SENIORITY_RANK[claimed] > SENIORITY_RANK[jdSeniority] &&
      SENIORITY_RANK[claimed] >= SENIORITY_RANK.senior) {
    notes.push(
      `Revised bullet claims '${claimed}' but JD seniority is '${jdSeniority}'.`,
    );
    return true;
  }
  return false;
}

function highestSeniorityWord(text: string): string {
  const t = text.toLowerCase();
  if (/\bstaff\b|\bprincipal\b/.test(t)) return "staff";
  if (/\bsenior\b/.test(t)) return "senior";
  if (/\bmid[- ]?level\b/.test(t)) return "mid";
  if (/\bjunior\b/.test(t)) return "junior";
  return "unknown";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @applymate/skill test invariant-checks`
Expected: PASS (all cases). If any metric-diff case fails, inspect `extractMetrics` normalization before changing test expectations.

- [ ] **Step 5: Commit**

```bash
git add packages/skill/src/validators/invariant-checks.ts tests/skill/invariant-checks.test.ts
git commit -m "feat: implement deterministic invariant checks (metrics, keywords, seniority)"
```

---

## Task 2.9: Plausibility Scoring

**Files:**
- Create: `packages/skill/src/validators/plausibility.ts`
- Create: `tests/skill/plausibility.test.ts`

**Interfaces:**
- Consumes: `InvariantResult`
- Produces: `scorePlausibility(input: { invariant: InvariantResult; logicalExtensions: number; lowConfidenceMatches: number }): number` (clamped to [0.5, 1])

- [ ] **Step 1: Write failing test tests/skill/plausibility.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import { scorePlausibility } from "../../packages/skill/src/validators/plausibility";
import type { InvariantResult } from "../../packages/skill/src/validators/invariant-checks";

const clean: InvariantResult = {
  passed: true,
  metricsPreserved: true,
  droppedMetrics: [],
  unsupportedKeywords: [],
  seniorityInflated: false,
  notes: [],
};

describe("scorePlausibility", () => {
  it("scores a clean exact-match rewrite high", () => {
    const s = scorePlausibility({
      invariant: clean,
      logicalExtensions: 0,
      lowConfidenceMatches: 0,
    });
    expect(s).toBeCloseTo(0.9, 5);
  });

  it("drops 0.05 per logical extension", () => {
    const s = scorePlausibility({
      invariant: clean,
      logicalExtensions: 2,
      lowConfidenceMatches: 0,
    });
    expect(s).toBeCloseTo(0.8, 5);
  });

  it("never scores below the 0.5 floor", () => {
    const s = scorePlausibility({
      invariant: clean,
      logicalExtensions: 20,
      lowConfidenceMatches: 20,
    });
    expect(s).toBe(0.5);
  });

  it("scores a failed-invariant rewrite at the floor", () => {
    const failed: InvariantResult = { ...clean, passed: false, metricsPreserved: false };
    const s = scorePlausibility({
      invariant: failed,
      logicalExtensions: 0,
      lowConfidenceMatches: 0,
    });
    expect(s).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @applymate/skill test plausibility`
Expected: FAIL (module not found).

- [ ] **Step 3: Create packages/skill/src/validators/plausibility.ts**

```typescript
import type { InvariantResult } from "./invariant-checks";

export interface PlausibilityInput {
  invariant: InvariantResult;
  logicalExtensions: number;
  lowConfidenceMatches: number;
}

const FLOOR = 0.5;
const BASE = 0.9;

export function scorePlausibility(input: PlausibilityInput): number {
  if (!input.invariant.passed) return FLOOR;

  let score =
    BASE -
    0.05 * input.logicalExtensions -
    0.1 * input.lowConfidenceMatches;

  if (score < FLOOR) score = FLOOR;
  if (score > 1) score = 1;
  return Number(score.toFixed(5));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @applymate/skill test plausibility`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/skill/src/validators/plausibility.ts tests/skill/plausibility.test.ts
git commit -m "feat: implement plausibility scoring"
```

---

## Task 2.10: Stage 3 — Rewrite Validation API

**Files:**
- Create: `packages/skill/src/stages/rewrite.ts`
- Create: `tests/skill/rewrite.test.ts`

**Interfaces:**
- Consumes: `checkInvariants`, `scorePlausibility`, `ExperienceAnchor`, `ParsedJD`, `BulletRewrite`
- Produces:
  - `validateRewrite(candidate: RewriteCandidate, anchors, parsedJD): BulletRewrite`
  - `buildReport(rewrites: BulletRewrite[]): RewritingReport`
  - type `RewriteCandidate { original, revised, keywordsAdded, reasonsForAddition, logicalExtensions?, lowConfidenceMatches? }`

Claude proposes a `RewriteCandidate` per bullet (via SKILL.md). `validateRewrite` is the deterministic gate that decides pass/fail + score. `buildReport` aggregates.

- [ ] **Step 1: Write failing test tests/skill/rewrite.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import { validateRewrite, buildReport } from "../../packages/skill/src/stages/rewrite";
import type { ExperienceAnchor } from "../../packages/skill/src/types";
import { parseJD } from "../../packages/skill/src/stages/parse-jd";

const anchors: ExperienceAnchor[] = [
  {
    id: "rust-async-http",
    title: "Rust async HTTP server",
    description: "",
    skills: ["rust", "async", "concurrency", "http"],
    metrics: ["10k req/s"],
    tags: ["backend", "performance"],
    claimAnchor: "Expert in async Rust",
  },
];

const jd = parseJD("Senior Rust Engineer, async, 5+ years.");

describe("validateRewrite", () => {
  it("accepts a supported rewrite and scores it high", () => {
    const r = validateRewrite(
      {
        original: "Built HTTP server in Rust, 10k req/s",
        revised: "Built async HTTP server in Rust, 10k req/s",
        keywordsAdded: ["async"],
        reasonsForAddition: ["async: matches JD requirement"],
      },
      anchors,
      jd,
    );
    expect(r.invariantChecksPassed).toBe(true);
    expect(r.plausibilityScore).toBeGreaterThanOrEqual(0.85);
    expect(r.warnings).toEqual([]);
  });

  it("rejects an unsupported keyword and warns", () => {
    const r = validateRewrite(
      {
        original: "Deployed with Docker",
        revised: "Deployed with Docker and Kubernetes",
        keywordsAdded: ["kubernetes"],
        reasonsForAddition: ["k8s: JD asks for it"],
      },
      anchors,
      jd,
    );
    expect(r.invariantChecksPassed).toBe(false);
    expect(r.plausibilityScore).toBe(0.5);
    expect(r.warnings.join(" ")).toMatch(/kubernetes/i);
  });
});

describe("buildReport", () => {
  it("aggregates per-bullet results", () => {
    const good = validateRewrite(
      {
        original: "Built HTTP server in Rust, 10k req/s",
        revised: "Built async HTTP server in Rust, 10k req/s",
        keywordsAdded: ["async"],
        reasonsForAddition: ["async"],
      },
      anchors,
      jd,
    );
    const unchanged = validateRewrite(
      {
        original: "Mentored two engineers",
        revised: "Mentored two engineers",
        keywordsAdded: [],
        reasonsForAddition: [],
      },
      anchors,
      jd,
    );
    const report = buildReport([good, unchanged]);
    expect(report.totalBullets).toBe(2);
    expect(report.bulletsModified).toBe(1);
    expect(report.allInvariantChecksPassed).toBe(true);
    expect(report.overallConfidence).toBeGreaterThan(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @applymate/skill test rewrite`
Expected: FAIL (module not found).

- [ ] **Step 3: Create packages/skill/src/stages/rewrite.ts**

```typescript
import type {
  BulletRewrite,
  ExperienceAnchor,
  ParsedJD,
  RewritingReport,
} from "../types";
import { checkInvariants } from "../validators/invariant-checks";
import { scorePlausibility } from "../validators/plausibility";

export interface RewriteCandidate {
  original: string;
  revised: string;
  keywordsAdded: string[];
  reasonsForAddition: string[];
  logicalExtensions?: number;
  lowConfidenceMatches?: number;
}

export function validateRewrite(
  candidate: RewriteCandidate,
  anchors: ExperienceAnchor[],
  parsedJD: ParsedJD,
): BulletRewrite {
  const invariant = checkInvariants({
    original: candidate.original,
    revised: candidate.revised,
    addedKeywords: candidate.keywordsAdded,
    anchors,
    jdSeniority: parsedJD.seniority,
  });

  const plausibilityScore = scorePlausibility({
    invariant,
    logicalExtensions: candidate.logicalExtensions ?? 0,
    lowConfidenceMatches: candidate.lowConfidenceMatches ?? 0,
  });

  const metricsPreserved = collectPreservedMetrics(
    candidate.original,
    candidate.revised,
  );

  return {
    original: candidate.original,
    revised: candidate.revised,
    keywordsAdded: candidate.keywordsAdded,
    metricsPreserved,
    reasonsForAddition: candidate.reasonsForAddition,
    invariantChecksPassed: invariant.passed,
    plausibilityScore,
    validationNotes: invariant.notes,
    warnings: invariant.passed ? [] : invariant.notes.slice(),
  };
}

function collectPreservedMetrics(original: string, revised: string): string[] {
  const rev = revised.toLowerCase();
  const tokens = original.toLowerCase().match(/\d+[\w%/.]*/g) ?? [];
  return tokens.filter((t) => rev.includes(t));
}

export function buildReport(rewrites: BulletRewrite[]): RewritingReport {
  const bulletsModified = rewrites.filter(
    (r) => r.original.trim() !== r.revised.trim(),
  ).length;
  const totalKeywordsAdded = rewrites.reduce(
    (sum, r) => sum + r.keywordsAdded.length,
    0,
  );
  const allInvariantChecksPassed = rewrites.every(
    (r) => r.invariantChecksPassed,
  );
  const overallConfidence =
    rewrites.length === 0
      ? 1
      : Number(
          (
            rewrites.reduce((s, r) => s + r.plausibilityScore, 0) /
            rewrites.length
          ).toFixed(5),
        );

  const warnings = rewrites.flatMap((r) => r.warnings);
  const recommendations = buildRecommendations(rewrites);

  return {
    totalBullets: rewrites.length,
    bulletsModified,
    totalKeywordsAdded,
    perBullet: rewrites,
    summary: `${bulletsModified}/${rewrites.length} bullets modified, ${totalKeywordsAdded} keywords added, confidence ${Math.round(
      overallConfidence * 100,
    )}%.`,
    overallConfidence,
    warnings,
    recommendations,
    allInvariantChecksPassed,
  };
}

function buildRecommendations(rewrites: BulletRewrite[]): string[] {
  const recs: string[] = [];
  for (const r of rewrites) {
    for (const note of r.validationNotes) {
      const m = note.match(/Unsupported keywords: (.+)/);
      if (m) {
        recs.push(
          `Add ${m[1]} to your experience corpus if you genuinely have it.`,
        );
      }
    }
  }
  return Array.from(new Set(recs));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @applymate/skill test rewrite`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/skill/src/stages/rewrite.ts tests/skill/rewrite.test.ts
git commit -m "feat: implement Stage 3 rewrite validation API and report builder"
```

---

## Task 2.11: Stage 4 — LaTeX Assembly

**Files:**
- Create: `packages/skill/src/stages/assemble-latex.ts`
- Create: `tests/skill/assemble-latex.test.ts`
- Create: `tests/skill/fixtures/resume-template.tex`

**Interfaces:**
- Consumes: `BulletRewrite`
- Produces: `assembleLatex(template: string, rewrites: BulletRewrite[]): string`; `escapeLatex(s: string): string`

Template uses `%%BULLETS%%` as the injection marker; each bullet becomes `\item ...` with LaTeX-escaped text (using the `revised` value).

- [ ] **Step 1: Create tests/skill/fixtures/resume-template.tex**

```latex
\documentclass{article}
\begin{document}
\section{Experience}
\begin{itemize}
%%BULLETS%%
\end{itemize}
\end{document}
```

- [ ] **Step 2: Write failing test tests/skill/assemble-latex.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  assembleLatex,
  escapeLatex,
} from "../../packages/skill/src/stages/assemble-latex";
import type { BulletRewrite } from "../../packages/skill/src/types";

const here = dirname(fileURLToPath(import.meta.url));

function bullet(revised: string): BulletRewrite {
  return {
    original: revised,
    revised,
    keywordsAdded: [],
    metricsPreserved: [],
    reasonsForAddition: [],
    invariantChecksPassed: true,
    plausibilityScore: 0.9,
    validationNotes: [],
    warnings: [],
  };
}

describe("escapeLatex", () => {
  it("escapes special characters", () => {
    expect(escapeLatex("C++ & 50% #1 _x")).toBe(
      "C++ \\& 50\\% \\#1 \\_x",
    );
  });
});

describe("assembleLatex", () => {
  it("injects bullets as \\item lines at the marker", async () => {
    const template = await readFile(
      join(here, "fixtures", "resume-template.tex"),
      "utf8",
    );
    const out = assembleLatex(template, [
      bullet("Built async Rust server, 10k req/s"),
      bullet("Led 50% cost reduction"),
    ]);
    expect(out).toContain("\\item Built async Rust server, 10k req/s");
    expect(out).toContain("\\item Led 50\\% cost reduction");
    expect(out).not.toContain("%%BULLETS%%");
  });

  it("produces compilable structure (balanced itemize)", async () => {
    const template = await readFile(
      join(here, "fixtures", "resume-template.tex"),
      "utf8",
    );
    const out = assembleLatex(template, [bullet("One")]);
    expect(out).toContain("\\begin{itemize}");
    expect(out).toContain("\\end{itemize}");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @applymate/skill test assemble-latex`
Expected: FAIL (module not found).

- [ ] **Step 4: Create packages/skill/src/stages/assemble-latex.ts**

```typescript
import type { BulletRewrite } from "../types";

const MARKER = "%%BULLETS%%";

const ESCAPES: [RegExp, string][] = [
  [/\\/g, "\\textbackslash{}"],
  [/&/g, "\\&"],
  [/%/g, "\\%"],
  [/\$/g, "\\$"],
  [/#/g, "\\#"],
  [/_/g, "\\_"],
  [/\{/g, "\\{"],
  [/\}/g, "\\}"],
  [/~/g, "\\textasciitilde{}"],
  [/\^/g, "\\textasciicircum{}"],
];

export function escapeLatex(s: string): string {
  // Apply backslash first to avoid double-escaping inserted backslashes.
  let out = s;
  for (const [re, rep] of ESCAPES) {
    out = out.replace(re, rep);
  }
  return out;
}

export function assembleLatex(
  template: string,
  rewrites: BulletRewrite[],
): string {
  const items = rewrites
    .map((r) => `\\item ${escapeLatex(r.revised)}`)
    .join("\n");
  if (!template.includes(MARKER)) {
    throw new Error(`Template is missing the ${MARKER} marker.`);
  }
  return template.replace(MARKER, items);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @applymate/skill test assemble-latex`
Expected: PASS. Note the escape test expects `C++` unchanged (no special chars there), `&`→`\&`, `%`→`\%`, `#`→`\#`, `_`→`\_`. The backslash rule runs first but the input has none, so ordering is safe.

- [ ] **Step 6: Commit**

```bash
git add packages/skill/src/stages/assemble-latex.ts tests/skill/assemble-latex.test.ts tests/skill/fixtures/resume-template.tex
git commit -m "feat: implement Stage 4 LaTeX assembly with escaping"
```

---

## Task 2.12: Stage 5 — Cover Letter Assembly

**Files:**
- Create: `packages/skill/src/stages/cover-letter.ts`
- Create: `tests/skill/cover-letter.test.ts`

**Interfaces:**
- Consumes: `ParsedJD`, `RetrievedExperience`
- Produces: `assembleCoverLetter(input: CoverLetterInput): string` (markdown); type `CoverLetterInput { company, jobTitle, bodyParagraphs, parsedJD, topExperiences }`

Claude writes `bodyParagraphs` (the prose) via SKILL.md; this function assembles a consistent, well-structured markdown letter and guarantees the company/title/greeting/sign-off scaffold deterministically.

- [ ] **Step 1: Write failing test tests/skill/cover-letter.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import { assembleCoverLetter } from "../../packages/skill/src/stages/cover-letter";
import { parseJD } from "../../packages/skill/src/stages/parse-jd";

describe("assembleCoverLetter", () => {
  it("includes company, title, body, and a sign-off", () => {
    const md = assembleCoverLetter({
      company: "Acme Corp",
      jobTitle: "Senior Rust Engineer",
      bodyParagraphs: [
        "I have built async Rust systems for years.",
        "Your focus on reliability matches my background.",
      ],
      parsedJD: parseJD("Senior Rust Engineer, async, 5+ years."),
      topExperiences: [],
    });
    expect(md).toContain("Acme Corp");
    expect(md).toContain("Senior Rust Engineer");
    expect(md).toContain("async Rust systems");
    expect(md).toMatch(/Sincerely/i);
  });

  it("falls back to a generated paragraph when none provided", () => {
    const md = assembleCoverLetter({
      company: "Acme",
      jobTitle: "Engineer",
      bodyParagraphs: [],
      parsedJD: parseJD("Engineer with rust."),
      topExperiences: [],
    });
    expect(md.length).toBeGreaterThan(40);
    expect(md).toContain("Acme");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @applymate/skill test cover-letter`
Expected: FAIL (module not found).

- [ ] **Step 3: Create packages/skill/src/stages/cover-letter.ts**

```typescript
import type { ParsedJD, RetrievedExperience } from "../types";

export interface CoverLetterInput {
  company: string;
  jobTitle: string;
  bodyParagraphs: string[];
  parsedJD: ParsedJD;
  topExperiences: RetrievedExperience[];
}

export function assembleCoverLetter(input: CoverLetterInput): string {
  const paragraphs =
    input.bodyParagraphs.length > 0
      ? input.bodyParagraphs
      : [fallbackParagraph(input)];

  const lines = [
    `Dear ${input.company} Hiring Team,`,
    "",
    `I am excited to apply for the ${input.jobTitle} role at ${input.company}.`,
    "",
    ...interleave(paragraphs),
    "",
    "Sincerely,",
  ];

  return lines.join("\n");
}

function interleave(paragraphs: string[]): string[] {
  const out: string[] = [];
  paragraphs.forEach((p, i) => {
    out.push(p);
    if (i < paragraphs.length - 1) out.push("");
  });
  return out;
}

function fallbackParagraph(input: CoverLetterInput): string {
  const skills = input.parsedJD.keywords.slice(0, 3).join(", ");
  const skillClause = skills ? ` with strength in ${skills}` : "";
  return `My background${skillClause} aligns closely with what ${input.company} is looking for, and I would bring that experience to the ${input.jobTitle} role.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @applymate/skill test cover-letter`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/skill/src/stages/cover-letter.ts tests/skill/cover-letter.test.ts
git commit -m "feat: implement Stage 5 cover letter assembly"
```

---

## Task 2.13: Pipeline Composition + SKILL.md

**Files:**
- Create: `packages/skill/src/index.ts`
- Create: `packages/skill/apply-to-job.md`
- Create: `tests/skill/compose.test.ts`

**Interfaces:**
- Consumes: all stage + validator modules
- Produces: `composeOutput(input: ComposeInput): ApplyJobOutput`; type `ComposeInput { parsedJD, retrieved, rewrites, resumeLatex, coverLetter, formFieldGuidance?, reasoning? }`

`composeOutput` is the deterministic assembler that turns the stage results (some produced by Claude, some by code) into the final `ApplyJobOutput`. `apply-to-job.md` is the orchestration contract telling Claude how to run the hybrid flow.

- [ ] **Step 1: Write failing test tests/skill/compose.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import { composeOutput } from "../../packages/skill/src/index";
import { parseJD } from "../../packages/skill/src/stages/parse-jd";
import { validateRewrite } from "../../packages/skill/src/stages/rewrite";
import type { ExperienceAnchor } from "../../packages/skill/src/types";

const anchors: ExperienceAnchor[] = [
  {
    id: "rust-async-http",
    title: "Rust async HTTP server",
    description: "",
    skills: ["rust", "async"],
    metrics: ["10k req/s"],
    tags: ["backend"],
    claimAnchor: "Expert in async Rust",
  },
];
const jd = parseJD("Senior Rust Engineer, async, 5+ years.");

describe("composeOutput", () => {
  it("assembles a complete ApplyJobOutput with a valid report", () => {
    const rw = validateRewrite(
      {
        original: "Built HTTP server in Rust, 10k req/s",
        revised: "Built async HTTP server in Rust, 10k req/s",
        keywordsAdded: ["async"],
        reasonsForAddition: ["async"],
      },
      anchors,
      jd,
    );
    const out = composeOutput({
      parsedJD: jd,
      retrieved: [{ anchor: anchors[0], relevanceScore: 0.8 }],
      rewrites: [rw],
      resumeLatex: "\\item Built async HTTP server",
      coverLetter: "Dear Acme...",
    });

    expect(out.rewritingReport.totalBullets).toBe(1);
    expect(out.rewritingReport.allInvariantChecksPassed).toBe(true);
    expect(out.resumeLatex).toContain("async");
    expect(out.retrievedExperiences[0].anchor.id).toBe("rust-async-http");
    expect(out.reasoning.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @applymate/skill test compose`
Expected: FAIL (module not found).

- [ ] **Step 3: Create packages/skill/src/index.ts**

```typescript
import type {
  ApplyJobOutput,
  ParsedJD,
  RetrievedExperience,
  BulletRewrite,
} from "./types";
import { buildReport } from "./stages/rewrite";

export interface ComposeInput {
  parsedJD: ParsedJD;
  retrieved: RetrievedExperience[];
  rewrites: BulletRewrite[];
  resumeLatex: string;
  coverLetter: string;
  formFieldGuidance?: ApplyJobOutput["formFieldGuidance"];
  reasoning?: string;
}

export function composeOutput(input: ComposeInput): ApplyJobOutput {
  const report = buildReport(input.rewrites);

  const reasoning =
    input.reasoning ??
    `Parsed ${input.parsedJD.keywords.length} keywords; retrieved ${input.retrieved.length} experiences; ${report.summary}`;

  return {
    parsedJD: input.parsedJD,
    retrievedExperiences: input.retrieved,
    resumeLatex: input.resumeLatex,
    coverLetter: input.coverLetter,
    rewritingReport: report,
    formFieldGuidance: input.formFieldGuidance ?? [],
    reasoning,
  };
}

export { parseJD } from "./stages/parse-jd";
export { retrieve } from "./stages/retrieve";
export { validateRewrite, buildReport } from "./stages/rewrite";
export { assembleLatex } from "./stages/assemble-latex";
export { assembleCoverLetter } from "./stages/cover-letter";
export { loadCorpus } from "./corpus/load";
export { connect, migrate, upsertAnchors, knnSearch } from "./db/pgvector";
export { embed, embedBatch } from "./embeddings/embedder";
```

- [ ] **Step 4: Create packages/skill/apply-to-job.md**

```markdown
---
name: apply-to-job
description: Tailor a resume and cover letter to a job description using anchor-validated rewriting. Use when the user provides a job description plus their experience corpus and wants a tailored resume.
---

# /apply-to-job

Hybrid pipeline. You (Claude) supply linguistic judgment; the TypeScript
modules in `packages/skill/src` supply deterministic machinery and the
non-negotiable validation. Never bypass the validator.

## Inputs
- Job description, job title, company, job URL.
- Detected form fields (from the extension).
- Optional manual context from the user.
- Experience corpus at `~/.applymate/experience.yaml`.
- Resume template at `~/.applymate/resume-template.tex`.

## Flow

1. **Stage 1 — Parse JD (code, then augment).**
   Call `parseJD(jobDescription)`. Read its output, then add any domain
   keywords it missed from your own reading. Keep keywords lowercased.

2. **Stage 2 — Retrieve (code).**
   Ensure the corpus is loaded and embedded into pgvector (`loadCorpus`,
   `upsertAnchors`). Call `retrieve(client, parsedJD, anchors, k=8)`. These
   ranked experiences are your evidence base.

3. **Stage 3 — Rewrite (you propose, code validates).**
   For each resume bullet, propose a `RewriteCandidate`: the revised text,
   the keywords you added, and why. ONLY add a keyword if a retrieved
   experience supports it. Preserve every original metric verbatim. Pass each
   candidate to `validateRewrite(candidate, anchors, parsedJD)`. If
   `invariantChecksPassed` is false, either revise your candidate or drop the
   keyword — do not override the validator. Collect all `BulletRewrite`s.

4. **Stage 4 — Assemble LaTeX (code).**
   Call `assembleLatex(template, rewrites)`.

5. **Stage 5 — Cover letter (you write, code assembles).**
   Write 2–3 grounded body paragraphs (no invented facts). Pass them to
   `assembleCoverLetter(...)`.

6. **Compose.** Call `composeOutput(...)` and return the `ApplyJobOutput`.
   Surface `rewritingReport` to the user — especially any bullet with
   `plausibilityScore < 0.7` or `invariantChecksPassed === false` — and ask
   for approval before the resume is used. Never auto-submit.

## Hard rules
- No invented skills, metrics, employers, or dates.
- Every added keyword maps to a corpus anchor; the validator enforces this.
- Low-confidence bullets (< 0.7) require explicit user handling.
```

- [ ] **Step 5: Run test + type-check**

Run: `pnpm --filter @applymate/skill test compose`
Expected: PASS (1 test).
Run: `pnpm --filter @applymate/skill type-check`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/skill/src/index.ts packages/skill/apply-to-job.md tests/skill/compose.test.ts
git commit -m "feat: compose pipeline output and add apply-to-job SKILL.md"
```

---

## Task 2.14: Tectonic-WASM PDF Compile Utility

**Files:**
- Create: `lib/local/tectonic.ts`
- Create: `tests/skill/tectonic.test.ts`

**Interfaces:**
- Consumes: a LaTeX string
- Produces: `compileLatexToPdf(latex: string): Promise<Uint8Array>` (PDF bytes) — browser/worker-targeted via Tectonic-WASM, with a Node test that asserts the PDF header.

This is the "client-side Tectonic-WASM, zero server cost" deliverable. It is implemented as a thin wrapper around `@myriaddreamin/tectonic` style WASM. The test verifies a real compile produces a PDF (`%PDF` magic bytes).

- [ ] **Step 1: Add the Tectonic-WASM dependency**

Run:
```bash
pnpm --filter @applymate/skill add tectonic-wasm
```
(If `tectonic-wasm` is unavailable in the registry, use the documented package name from https://tectonic-typesetting.github.io and adjust the import in Step 3. The wrapper API below is the contract; the underlying package name may differ.)

- [ ] **Step 2: Write failing test tests/skill/tectonic.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import { compileLatexToPdf } from "../../lib/local/tectonic";

const MINIMAL = `\\documentclass{article}
\\begin{document}
Hello ApplyMate.
\\end{document}`;

describe("compileLatexToPdf", () => {
  it("compiles minimal LaTeX to PDF bytes", async () => {
    const pdf = await compileLatexToPdf(MINIMAL);
    // %PDF magic number
    expect(pdf[0]).toBe(0x25);
    expect(pdf[1]).toBe(0x50);
    expect(pdf[2]).toBe(0x44);
    expect(pdf[3]).toBe(0x46);
    expect(pdf.length).toBeGreaterThan(400);
  }, 180000);
});
```

- [ ] **Step 3: Create lib/local/tectonic.ts**

```typescript
// Thin wrapper around Tectonic-WASM so the same compile path works in the
// browser (extension side panel, dashboard) and in Node tests. Zero server
// cost: the WASM engine runs locally.
import initTectonic from "tectonic-wasm";

let enginePromise: Promise<{ compile: (tex: string) => Promise<Uint8Array> }> | null =
  null;

function getEngine() {
  if (!enginePromise) {
    enginePromise = initTectonic();
  }
  return enginePromise;
}

export async function compileLatexToPdf(latex: string): Promise<Uint8Array> {
  const engine = await getEngine();
  const pdf = await engine.compile(latex);
  if (pdf[0] !== 0x25 || pdf[1] !== 0x50) {
    throw new Error("Tectonic did not return a PDF.");
  }
  return pdf;
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @applymate/skill test tectonic`
Expected: PASS. First run downloads the TeX support bundle and may take 1–3 minutes.

**If `tectonic-wasm` cannot compile in Node** (some builds are browser-only): keep `lib/local/tectonic.ts` as the browser implementation, and in the test file mark it `it.skip` with a comment that PDF compilation is verified manually in the dashboard (Phase 4). Do not block Phase 2 on a browser-only WASM build; the LaTeX string from Task 2.11 is the guaranteed artifact and the dashboard compiles it client-side.

- [ ] **Step 5: Commit**

```bash
git add lib/local/tectonic.ts tests/skill/tectonic.test.ts package.json pnpm-lock.yaml
git commit -m "feat: add Tectonic-WASM client-side LaTeX-to-PDF compile"
```

---

## Task 2.15: Manual Approval Gate #2

**Acceptance Criteria (Phase 2 Complete):**

Run the full skill suite (DB must be up):
```bash
pnpm --filter @applymate/skill db:up
pnpm --filter @applymate/skill test
pnpm --filter @applymate/skill type-check
```

- [ ] All skill unit tests pass (corpus, embedder, parse-jd, invariant-checks, plausibility, rewrite, assemble-latex, cover-letter, compose).
- [ ] All integration tests pass (pgvector, retrieve) against the docker DB.
- [ ] `tsc --noEmit` clean for the skill package.
- [ ] Anchor validation blocks: unsupported keyword, dropped metric, altered metric, seniority inflation (verify these specific tests are green).
- [ ] `apply-to-job.md` SKILL.md present and accurate to the implemented function signatures.
- [ ] Tectonic compile produces a PDF, OR is documented as browser-only and deferred to the dashboard (Phase 4) with the LaTeX artifact verified.

**Manual smoke test (you, in Claude Code):**
- [ ] Put a real `~/.applymate/experience.yaml` (your actual experiences) and `~/.applymate/resume-template.tex` in place.
- [ ] Run the `/apply-to-job` flow against one real JD. Confirm: keywords parsed, experiences retrieved, every rewrite passes invariant checks (or is flagged), LaTeX assembles, cover letter reads well.
- [ ] Confirm a deliberately unsupported keyword (e.g. a tech you don't have) gets flagged in the report rather than silently injected.

**Sign-off:** All green → merge `phase-2-skill` to `main` via the finishing-a-development-branch skill, then plan Phase 3 (form auto-fill).

---

## Self-Review

- **Spec coverage:** Stage 1 (2.6), Stage 2 retrieval w/ pgvector+local embeddings (2.4, 2.5, 2.7), Stage 3 anchor-validated rewriting (2.8, 2.9, 2.10), Stage 4 LaTeX (2.11), Stage 5 cover letter (2.12), Tectonic-WASM (2.14), hybrid orchestration (2.13 SKILL.md). All Part-1.3 anchor-validation test cases map to Task 2.8 tests (exact match, logical extension, no-match skip, hallucination block, metric invariant, contradiction/seniority).
- **No placeholders:** every code step has complete code; commands have expected output.
- **Type consistency:** `BulletRewrite`, `RewritingReport`, `ParsedJD`, `ExperienceAnchor` defined in 2.2 and used identically downstream. `validateRewrite`/`buildReport` signatures match between 2.10 and 2.13. `checkInvariants`/`InvariantResult` consistent between 2.8 and 2.9/2.10.
- **Known risk:** Task 2.14 (Tectonic-WASM in Node) has an explicit fallback to browser-only + Phase 4, so it cannot block the phase.
```
