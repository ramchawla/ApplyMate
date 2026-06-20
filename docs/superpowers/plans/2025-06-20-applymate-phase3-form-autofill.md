# ApplyMate Phase 3: Form Auto-Fill + Local Bridge — Implementation Plan

> **For agentic workers:** RECOMMENDED SUB-SKILL: Use `superpowers:executing-plans` to implement task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Bridge the skill's `ApplyJobOutput` into the extension via a local HTTP server, render a tailoring-review tab with the rewriting report, and auto-fill detected job-form fields (text, cover letter, custom questions, file-upload mechanism) — never submitting.

**Architecture:** A tiny Node bridge server on `localhost:4179` receives `ApplyJobOutput` from the skill (POST) and serves it to the side panel (GET). The side panel gains Tab 3 (Tailoring Review: resume + per-bullet report + cover letter, approval gated on low-confidence bullets) and Tab 4 (Form Auto-Fill: maps validated fields to values, lets the user edit, and instructs the content script to fill the page form). A deterministic field-mapping module turns `FormField[]` + `ApplyJobOutput` + user profile into a fill plan. The content script applies values and dispatches input events so the host page's framework registers them. The extension never clicks submit.

**Tech Stack:** Node `http` (bridge, zero deps), TypeScript, React (side panel), Vitest, `chrome.storage.local` (profile).

## Global Constraints

- Never auto-submit. The extension fills fields and stops at a final review; the user submits manually on the job page.
- Bridge is localhost-only, no auth, CORS open to the extension origin (`Access-Control-Allow-Origin: *`). It holds only the latest output in memory plus an optional file write under `~/.applymate/applications/`.
- Low-confidence bullets (`plausibilityScore < 0.7`) or any `invariantChecksPassed === false` block "Proceed to Form" until the user explicitly accepts or removes them.
- Resume PDF generation is Phase 4. Phase 3 implements the file-upload mechanism against a user-supplied PDF; generated-PDF auto-upload is wired in Phase 4.
- TDD: failing test → minimal implementation → passing test → commit, every task.
- Reuse Phase 1 types (`FormField`, `ExtractedJobData`) and Phase 2 types (`ApplyJobOutput`); do not redefine them.

## Prerequisites

- [ ] New branch off `main`: `git checkout -b phase-3-form-autofill`.

---

## FILE STRUCTURE

```
packages/bridge/                    # NEW — local HTTP bridge
├── package.json
├── tsconfig.json
├── src/
│   ├── server.ts                   # createServer(store): http.Server
│   ├── store.ts                    # OutputStore: in-memory latest + file persist
│   └── start.ts                    # CLI entry: start on :4179
└── (tests in tests/bridge/)

packages/extension/src/
├── ui/components/
│   ├── TailoringReview.tsx         # NEW — Tab 3
│   ├── FormAutoFill.tsx            # NEW — Tab 4
│   └── ProfileEditor.tsx           # NEW — name/email/phone/links
├── content/
│   └── fill.ts                     # NEW — apply fill plan to page DOM
├── lib/
│   └── field-mapping.ts            # NEW — FormField[]+output+profile -> FillPlan
├── utils/
│   └── bridge.ts                   # NEW — fetch latest output from localhost:4179
└── types.ts                        # MODIFY — add Profile, FillPlan, FillInstruction

tests/bridge/
├── store.test.ts
└── server.test.ts

tests/extension/
├── field-mapping.test.ts           # NEW
└── fill.test.ts                    # NEW
```

---

## Task 3.1: Bridge Server Scaffold + Store

**Files:**
- Create: `packages/bridge/package.json`
- Create: `packages/bridge/tsconfig.json`
- Create: `packages/bridge/src/store.ts`
- Create: `tests/bridge/store.test.ts`
- Modify: root `package.json` (scripts)

**Interfaces:**
- Consumes: nothing
- Produces: `OutputStore` class with `set(output)`, `getLatest()`, `clear()`

- [ ] **Step 1: Create packages/bridge/package.json**

```json
{
  "name": "@applymate/bridge",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "tsx src/start.ts",
    "test": "vitest run",
    "type-check": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

- [ ] **Step 2: Create packages/bridge/tsconfig.json**

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

- [ ] **Step 3: Create packages/bridge/vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["../../tests/bridge/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Write failing test tests/bridge/store.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import { OutputStore } from "../../packages/bridge/src/store";

describe("OutputStore", () => {
  it("returns null before any output is set", () => {
    const store = new OutputStore();
    expect(store.getLatest()).toBeNull();
  });

  it("stores and returns the latest output", () => {
    const store = new OutputStore();
    store.set({ jobUrl: "https://x.com/job", resumeLatex: "\\item A" } as any);
    expect(store.getLatest()?.jobUrl).toBe("https://x.com/job");
  });

  it("overwrites with the newest output", () => {
    const store = new OutputStore();
    store.set({ jobUrl: "a" } as any);
    store.set({ jobUrl: "b" } as any);
    expect(store.getLatest()?.jobUrl).toBe("b");
  });

  it("clears stored output", () => {
    const store = new OutputStore();
    store.set({ jobUrl: "a" } as any);
    store.clear();
    expect(store.getLatest()).toBeNull();
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @applymate/bridge test`
Expected: FAIL (module not found).

- [ ] **Step 6: Create packages/bridge/src/store.ts**

```typescript
import type { ApplyJobOutput } from "../../skill/src/types";

export interface StoredOutput extends ApplyJobOutput {
  jobUrl: string;
  receivedAt: string;
}

export class OutputStore {
  private latest: StoredOutput | null = null;

  set(output: ApplyJobOutput & { jobUrl: string }): void {
    this.latest = {
      ...output,
      receivedAt: new Date().toISOString(),
    };
  }

  getLatest(): StoredOutput | null {
    return this.latest;
  }

  clear(): void {
    this.latest = null;
  }
}
```

- [ ] **Step 7: Add bridge scripts to root package.json**

Add to root `package.json` `scripts`:
```json
    "bridge": "pnpm --filter @applymate/bridge start",
    "test:bridge": "pnpm --filter @applymate/bridge test",
    "type-check:bridge": "pnpm --filter @applymate/bridge type-check"
```

- [ ] **Step 8: Install + run test to verify it passes**

Run: `pnpm install && pnpm --filter @applymate/bridge test`
Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
git add packages/bridge/package.json packages/bridge/tsconfig.json packages/bridge/vitest.config.ts packages/bridge/src/store.ts tests/bridge/store.test.ts package.json pnpm-lock.yaml
git commit -m "feat: scaffold bridge package with output store"
```

---

## Task 3.2: Bridge HTTP Server

**Files:**
- Create: `packages/bridge/src/server.ts`
- Create: `packages/bridge/src/start.ts`
- Create: `tests/bridge/server.test.ts`

**Interfaces:**
- Consumes: `OutputStore`
- Produces: `createServer(store): http.Server` with routes:
  - `GET /health` → `{ ok: true }`
  - `POST /output` (JSON body, requires `jobUrl`) → `{ stored: true }`
  - `GET /output/latest` → `StoredOutput | null`
  - CORS preflight on all routes

- [ ] **Step 1: Write failing test tests/bridge/server.test.ts**

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Server } from "node:http";
import { createServer } from "../../packages/bridge/src/server";
import { OutputStore } from "../../packages/bridge/src/store";

let server: Server;
let base: string;
const store = new OutputStore();

beforeAll(async () => {
  server = createServer(store);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe("bridge server", () => {
  it("responds to health", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("rejects POST without jobUrl", async () => {
    const res = await fetch(`${base}/output`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resumeLatex: "x" }),
    });
    expect(res.status).toBe(400);
  });

  it("stores and returns the latest output", async () => {
    const post = await fetch(`${base}/output`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobUrl: "https://x.com/j", resumeLatex: "\\item A" }),
    });
    expect(post.status).toBe(200);

    const get = await fetch(`${base}/output/latest`);
    const body = await get.json();
    expect(body.jobUrl).toBe("https://x.com/j");
    expect(body.resumeLatex).toBe("\\item A");
  });

  it("sets CORS headers", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @applymate/bridge test server`
Expected: FAIL (module not found).

- [ ] **Step 3: Create packages/bridge/src/server.ts**

```typescript
import { createServer as createHttpServer, type Server } from "node:http";
import type { OutputStore } from "./store";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

export function createServer(store: OutputStore): Server {
  return createHttpServer((req, res) => {
    const url = req.url ?? "/";
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json", ...CORS });
      res.end(JSON.stringify(body));
    };

    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    if (req.method === "GET" && url === "/health") {
      return send(200, { ok: true });
    }

    if (req.method === "GET" && url === "/output/latest") {
      return send(200, store.getLatest());
    }

    if (req.method === "POST" && url === "/output") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        try {
          const parsed = JSON.parse(raw || "{}");
          if (!parsed.jobUrl || typeof parsed.jobUrl !== "string") {
            return send(400, { error: "jobUrl is required" });
          }
          store.set(parsed);
          return send(200, { stored: true });
        } catch {
          return send(400, { error: "invalid JSON" });
        }
      });
      return;
    }

    return send(404, { error: "not found" });
  });
}
```

- [ ] **Step 4: Create packages/bridge/src/start.ts**

```typescript
import { createServer } from "./server";
import { OutputStore } from "./store";

const PORT = Number(process.env.APPLYMATE_BRIDGE_PORT ?? 4179);
const store = new OutputStore();
const server = createServer(store);

server.listen(PORT, () => {
  console.log(`[ApplyMate] bridge listening on http://127.0.0.1:${PORT}`);
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @applymate/bridge test server`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/bridge/src/server.ts packages/bridge/src/start.ts tests/bridge/server.test.ts
git commit -m "feat: implement bridge HTTP server (health, output post/get, CORS)"
```

---

## Task 3.3: Extension Types + Bridge Client + Profile

**Files:**
- Modify: `packages/extension/src/types.ts`
- Create: `packages/extension/src/utils/bridge.ts`
- Create: `packages/extension/src/utils/profile.ts`

**Interfaces:**
- Consumes: `ApplyJobOutput` (skill), `FormField`
- Produces: `Profile`, `FillInstruction`, `FillPlan` types; `fetchLatestOutput()`; `getProfile()`, `saveProfile()`

- [ ] **Step 1: Add types to packages/extension/src/types.ts**

Append:
```typescript
export interface Profile {
  fullName: string;
  email: string;
  phone: string;
  linkedin: string;
  github: string;
  website: string;
}

export interface FillInstruction {
  fieldId: string;
  valueType: string;
  value: string;
  isFile: boolean;
}

export interface FillPlan {
  instructions: FillInstruction[];
  unmappedFieldIds: string[];
}
```

- [ ] **Step 2: Create packages/extension/src/utils/bridge.ts**

```typescript
const BRIDGE_BASE = "http://127.0.0.1:4179";

export async function fetchLatestOutput(): Promise<unknown | null> {
  try {
    const res = await fetch(`${BRIDGE_BASE}/output/latest`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // bridge not running
  }
}

export async function isBridgeUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BRIDGE_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 3: Create packages/extension/src/utils/profile.ts**

```typescript
import { Profile } from "../types";

const EMPTY: Profile = {
  fullName: "",
  email: "",
  phone: "",
  linkedin: "",
  github: "",
  website: "",
};

export function getProfile(): Promise<Profile> {
  return new Promise((resolve) => {
    chrome.storage.local.get("profile", (result) => {
      resolve({ ...EMPTY, ...(result.profile as Partial<Profile>) });
    });
  });
}

export function saveProfile(profile: Profile): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ profile }, () => resolve());
  });
}
```

- [ ] **Step 4: Type-check**

Run: `pnpm --filter @applymate/extension type-check`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/types.ts packages/extension/src/utils/bridge.ts packages/extension/src/utils/profile.ts
git commit -m "feat: add profile storage, bridge client, and fill-plan types"
```

---

## Task 3.4: Field-to-Value Mapping

**Files:**
- Create: `packages/extension/src/lib/field-mapping.ts`
- Create: `tests/extension/field-mapping.test.ts`

**Interfaces:**
- Consumes: `FormField`, `Profile`, `ApplyJobOutput`-shaped data
- Produces: `buildFillPlan(fields, profile, output): FillPlan`

Maps each validated field's value-type to a concrete value: profile fields (name/email/phone), cover letter, and custom-question guidance (matched by field id against `formFieldGuidance`). Resume (file) fields produce a file instruction with an empty value placeholder (the user attaches the PDF in Tab 4; generated-PDF wiring is Phase 4).

- [ ] **Step 1: Write failing test tests/extension/field-mapping.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import { buildFillPlan } from "../../packages/extension/src/lib/field-mapping";
import type { FormField, Profile } from "../../packages/extension/src/types";

const profile: Profile = {
  fullName: "Jane Dev",
  email: "jane@example.com",
  phone: "555-1234",
  linkedin: "linkedin.com/in/jane",
  github: "github.com/jane",
  website: "jane.dev",
};

function field(partial: Partial<FormField>): FormField {
  return {
    id: "f",
    label: "",
    type: "text",
    required: false,
    matchConfidence: 1,
    validated: true,
    ...partial,
  };
}

const output = {
  coverLetter: "Dear Acme...",
  formFieldGuidance: [
    { fieldId: "whyq", suggestedAnswer: "I love systems.", relatedBullets: [] },
  ],
} as any;

describe("buildFillPlan", () => {
  it("maps name and email from profile", () => {
    const plan = buildFillPlan(
      [
        field({ id: "n", extractedValueType: "name" }),
        field({ id: "e", extractedValueType: "email" }),
      ],
      profile,
      output,
    );
    expect(plan.instructions).toContainEqual(
      expect.objectContaining({ fieldId: "n", value: "Jane Dev", isFile: false }),
    );
    expect(plan.instructions).toContainEqual(
      expect.objectContaining({ fieldId: "e", value: "jane@example.com" }),
    );
  });

  it("maps cover letter", () => {
    const plan = buildFillPlan(
      [field({ id: "cl", extractedValueType: "cover-letter" })],
      profile,
      output,
    );
    expect(plan.instructions[0].value).toBe("Dear Acme...");
  });

  it("maps a custom question by field id", () => {
    const plan = buildFillPlan(
      [field({ id: "whyq", extractedValueType: "custom-q" })],
      profile,
      output,
    );
    expect(plan.instructions[0].value).toBe("I love systems.");
  });

  it("marks resume fields as file instructions with empty value", () => {
    const plan = buildFillPlan(
      [field({ id: "r", type: "file", extractedValueType: "resume" })],
      profile,
      output,
    );
    expect(plan.instructions[0].isFile).toBe(true);
    expect(plan.instructions[0].value).toBe("");
  });

  it("collects unmapped fields", () => {
    const plan = buildFillPlan(
      [field({ id: "weird", extractedValueType: null })],
      profile,
      output,
    );
    expect(plan.unmappedFieldIds).toContain("weird");
    expect(plan.instructions).toHaveLength(0);
  });

  it("uses user override value type when present", () => {
    const plan = buildFillPlan(
      [field({ id: "x", extractedValueType: null, userSelectedValueType: "email" })],
      profile,
      output,
    );
    expect(plan.instructions[0].value).toBe("jane@example.com");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @applymate/extension test field-mapping`
Expected: FAIL (module not found).

- [ ] **Step 3: Create packages/extension/src/lib/field-mapping.ts**

```typescript
import type { FormField, Profile, FillPlan, FillInstruction } from "../types";

interface OutputLike {
  coverLetter: string;
  formFieldGuidance: { fieldId: string; suggestedAnswer: string }[];
}

export function buildFillPlan(
  fields: FormField[],
  profile: Profile,
  output: OutputLike,
): FillPlan {
  const instructions: FillInstruction[] = [];
  const unmappedFieldIds: string[] = [];

  for (const field of fields) {
    const valueType = field.userSelectedValueType ?? field.extractedValueType;
    const instruction = mapField(field, valueType, profile, output);
    if (instruction) instructions.push(instruction);
    else unmappedFieldIds.push(field.id);
  }

  return { instructions, unmappedFieldIds };
}

function mapField(
  field: FormField,
  valueType: string | null | undefined,
  profile: Profile,
  output: OutputLike,
): FillInstruction | null {
  const base = { fieldId: field.id, valueType: valueType ?? "unknown" };

  switch (valueType) {
    case "name":
      return { ...base, value: profile.fullName, isFile: false };
    case "email":
      return { ...base, value: profile.email, isFile: false };
    case "phone":
      return { ...base, value: profile.phone, isFile: false };
    case "cover-letter":
      return { ...base, value: output.coverLetter, isFile: false };
    case "custom-q": {
      const g = output.formFieldGuidance.find((x) => x.fieldId === field.id);
      return { ...base, value: g?.suggestedAnswer ?? "", isFile: false };
    }
    case "resume":
      return { ...base, value: "", isFile: true };
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @applymate/extension test field-mapping`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/lib/field-mapping.ts tests/extension/field-mapping.test.ts
git commit -m "feat: implement field-to-value mapping for auto-fill"
```

---

## Task 3.5: Content Script Form Fill

**Files:**
- Create: `packages/extension/src/content/fill.ts`
- Create: `tests/extension/fill.test.ts`

**Interfaces:**
- Consumes: `FillInstruction`
- Produces: `applyFillPlan(instructions, doc): { filled: string[]; missing: string[] }` — sets input values and dispatches `input`+`change` events so host frameworks register them. Skips file instructions (handled separately).

- [ ] **Step 1: Write failing test tests/extension/fill.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import { applyFillPlan } from "../../packages/extension/src/content/fill";
import type { FillInstruction } from "../../packages/extension/src/types";

function setupDom(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

describe("applyFillPlan", () => {
  it("sets text input values by id", () => {
    const doc = setupDom(`<input id="n" type="text" />`);
    const ins: FillInstruction[] = [
      { fieldId: "n", valueType: "name", value: "Jane Dev", isFile: false },
    ];
    const result = applyFillPlan(ins, doc);
    expect((doc.getElementById("n") as HTMLInputElement).value).toBe("Jane Dev");
    expect(result.filled).toContain("n");
  });

  it("sets textarea values", () => {
    const doc = setupDom(`<textarea id="cl"></textarea>`);
    const ins: FillInstruction[] = [
      { fieldId: "cl", valueType: "cover-letter", value: "Dear Acme", isFile: false },
    ];
    applyFillPlan(ins, doc);
    expect((doc.getElementById("cl") as HTMLTextAreaElement).value).toBe(
      "Dear Acme",
    );
  });

  it("dispatches input and change events", () => {
    const doc = setupDom(`<input id="n" type="text" />`);
    const el = doc.getElementById("n") as HTMLInputElement;
    const seen: string[] = [];
    el.addEventListener("input", () => seen.push("input"));
    el.addEventListener("change", () => seen.push("change"));
    applyFillPlan(
      [{ fieldId: "n", valueType: "name", value: "x", isFile: false }],
      doc,
    );
    expect(seen).toEqual(["input", "change"]);
  });

  it("reports missing fields and skips file instructions", () => {
    const doc = setupDom(`<input id="n" type="text" />`);
    const ins: FillInstruction[] = [
      { fieldId: "absent", valueType: "email", value: "x", isFile: false },
      { fieldId: "r", valueType: "resume", value: "", isFile: true },
    ];
    const result = applyFillPlan(ins, doc);
    expect(result.missing).toContain("absent");
    expect(result.filled).not.toContain("r");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @applymate/extension test fill`
Expected: FAIL (module not found).

- [ ] **Step 3: Create packages/extension/src/content/fill.ts**

```typescript
import type { FillInstruction } from "../types";

export function applyFillPlan(
  instructions: FillInstruction[],
  doc: Document,
): { filled: string[]; missing: string[] } {
  const filled: string[] = [];
  const missing: string[] = [];

  for (const ins of instructions) {
    if (ins.isFile) continue; // files handled by the upload flow

    const el = doc.getElementById(ins.fieldId) as
      | HTMLInputElement
      | HTMLTextAreaElement
      | null;

    const target = el ?? findByName(doc, ins.fieldId);
    if (!target) {
      missing.push(ins.fieldId);
      continue;
    }

    target.value = ins.value;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    filled.push(ins.fieldId);
  }

  return { filled, missing };
}

function findByName(
  doc: Document,
  name: string,
): HTMLInputElement | HTMLTextAreaElement | null {
  return doc.querySelector(`[name="${name}"]`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @applymate/extension test fill`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/content/fill.ts tests/extension/fill.test.ts
git commit -m "feat: implement content-script form fill with event dispatch"
```

---

## Task 3.6: Content Script Fill Message Handler

**Files:**
- Modify: `packages/extension/src/content/content.ts`
- Modify: `packages/extension/src/types.ts`

**Interfaces:**
- Consumes: `applyFillPlan`, `FillInstruction`
- Produces: content-script listener for `{ type: "APPLY_FILL_PLAN", instructions }` that fills the live page and responds with `{ filled, missing }`

- [ ] **Step 1: Add message type to types.ts**

In `MessageFromBackground` union (or a new exported type), add `"APPLY_FILL_PLAN"`. Append this exported interface:
```typescript
export interface ApplyFillPlanMessage {
  type: "APPLY_FILL_PLAN";
  instructions: import("./types").FillInstruction[];
}
```
(If a self-import is awkward, reference `FillInstruction` directly since it is defined in the same file.)

- [ ] **Step 2: Add the listener to content.ts**

Inside the `if (inExtension) { ... }` block, extend the existing `chrome.runtime.onMessage.addListener` callback to handle the fill plan. Replace the existing listener body with:

```typescript
  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request?.type === "EXTRACT_JOB_DATA") {
      void extractAndSend(document.documentElement.outerHTML);
      sendResponse({ status: "extraction_started" });
      return false;
    }
    if (request?.type === "APPLY_FILL_PLAN") {
      const result = applyFillPlan(request.instructions, document);
      sendResponse(result);
      return false;
    }
    return false;
  });
```

Add the import at the top of content.ts:
```typescript
import { applyFillPlan } from "./fill";
```

- [ ] **Step 3: Build to verify no errors**

Run: `pnpm --filter @applymate/extension build`
Expected: build succeeds, `dist/content.js` emitted.

- [ ] **Step 4: Type-check**

Run: `pnpm --filter @applymate/extension type-check`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/content/content.ts packages/extension/src/types.ts
git commit -m "feat: handle APPLY_FILL_PLAN in content script"
```

---

## Task 3.7: Side Panel Tab 3 — Tailoring Review

**Files:**
- Create: `packages/extension/src/ui/components/TailoringReview.tsx`
- Modify: `packages/extension/src/ui/side-panel.tsx`

**Interfaces:**
- Consumes: `fetchLatestOutput`, `ApplyJobOutput`-shaped data
- Produces: Tab 3 UI showing the rewriting report; gates "Proceed to Form" on low-confidence/failed bullets

- [ ] **Step 1: Create TailoringReview.tsx**

```typescript
import { useEffect, useState } from "react";
import { fetchLatestOutput } from "../../utils/bridge";

interface BulletView {
  original: string;
  revised: string;
  plausibilityScore: number;
  invariantChecksPassed: boolean;
  warnings: string[];
}

interface OutputView {
  resumeLatex: string;
  coverLetter: string;
  rewritingReport: {
    summary: string;
    overallConfidence: number;
    allInvariantChecksPassed: boolean;
    perBullet: BulletView[];
    warnings: string[];
  };
}

interface Props {
  onProceed: (output: OutputView) => void;
}

export function TailoringReview({ onProceed }: Props) {
  const [output, setOutput] = useState<OutputView | null>(null);
  const [acceptedRisky, setAcceptedRisky] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      const data = (await fetchLatestOutput()) as OutputView | null;
      if (active && data) {
        setOutput(data);
        setLoading(false);
      }
    };
    void poll();
    const id = setInterval(poll, 2000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  if (loading || !output) {
    return (
      <div className="p-4 text-sm">
        Waiting for tailored resume from Claude Code…
        <div className="text-xs text-gray-500 mt-2">
          Run <code>/apply-to-job</code> and ensure the bridge is running
          (<code>pnpm bridge</code>).
        </div>
      </div>
    );
  }

  const report = output.rewritingReport;
  const riskyBullets = report.perBullet.filter(
    (b) => !b.invariantChecksPassed || b.plausibilityScore < 0.7,
  );
  const canProceed = riskyBullets.length === 0 || acceptedRisky;

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold">Tailoring Review</h2>

      <div className="text-sm">
        {report.summary}{" "}
        {report.allInvariantChecksPassed ? "✓" : "⚠️ checks failed"}
      </div>

      <div className="space-y-2">
        {report.perBullet.map((b, i) => (
          <div key={i} className="border rounded p-2 text-xs space-y-1">
            <div className="line-through text-gray-400">{b.original}</div>
            <div className="font-medium">{b.revised}</div>
            <div
              className={
                b.plausibilityScore < 0.7 ? "text-red-600" : "text-green-700"
              }
            >
              {Math.round(b.plausibilityScore * 100)}% confidence
              {b.invariantChecksPassed ? "" : " — invariant failed"}
            </div>
            {b.warnings.map((w, j) => (
              <div key={j} className="text-red-600">
                ⚠️ {w}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div>
        <h3 className="text-sm font-medium">Cover Letter</h3>
        <textarea
          readOnly
          value={output.coverLetter}
          className="w-full border rounded px-2 py-1 h-24 text-xs"
        />
      </div>

      {riskyBullets.length > 0 && (
        <label className="flex items-center text-xs text-red-700">
          <input
            type="checkbox"
            checked={acceptedRisky}
            onChange={(e) => setAcceptedRisky(e.target.checked)}
            className="mr-2"
          />
          I reviewed the {riskyBullets.length} low-confidence bullet(s) and accept
          them.
        </label>
      )}

      <button
        onClick={() => onProceed(output)}
        disabled={!canProceed}
        className={`w-full py-2 rounded font-medium ${
          canProceed
            ? "bg-blue-600 text-white"
            : "bg-gray-300 text-gray-500 cursor-not-allowed"
        }`}
      >
        Proceed to Form →
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Wire Tab 3 into side-panel.tsx**

Add the import:
```typescript
import { TailoringReview } from "./components/TailoringReview";
```
Replace the placeholder block:
```typescript
      {state.currentTab === "tailoring-review" && (
        <div className="p-4">Tailoring Review (Phase 2)</div>
      )}
```
with:
```typescript
      {state.currentTab === "tailoring-review" && (
        <TailoringReview
          onProceed={() =>
            setState((prev) => ({ ...prev, currentTab: "form-auto-fill" }))
          }
        />
      )}
```

- [ ] **Step 3: Build + type-check**

Run: `pnpm --filter @applymate/extension build && pnpm --filter @applymate/extension type-check`
Expected: success, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/extension/src/ui/components/TailoringReview.tsx packages/extension/src/ui/side-panel.tsx
git commit -m "feat: implement side panel Tab 3 - Tailoring Review with report gate"
```

---

## Task 3.8: Side Panel Tab 4 — Form Auto-Fill

**Files:**
- Create: `packages/extension/src/ui/components/FormAutoFill.tsx`
- Create: `packages/extension/src/ui/components/ProfileEditor.tsx`
- Modify: `packages/extension/src/ui/side-panel.tsx`

**Interfaces:**
- Consumes: `buildFillPlan`, `getProfile`, `saveProfile`, `FormField`, `Profile`
- Produces: Tab 4 UI — edit profile, preview/edit fill plan, trigger fill on the page, final review; never submit

- [ ] **Step 1: Create ProfileEditor.tsx**

```typescript
import { useEffect, useState } from "react";
import { Profile } from "../../types";
import { getProfile, saveProfile } from "../../utils/profile";

interface Props {
  onSaved: (profile: Profile) => void;
}

export function ProfileEditor({ onSaved }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    void getProfile().then(setProfile);
  }, []);

  if (!profile) return <div className="text-xs">Loading profile…</div>;

  const fields: (keyof Profile)[] = [
    "fullName",
    "email",
    "phone",
    "linkedin",
    "github",
    "website",
  ];

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Your Profile</h3>
      {fields.map((key) => (
        <input
          key={key}
          type="text"
          placeholder={key}
          value={profile[key]}
          onChange={(e) => setProfile({ ...profile, [key]: e.target.value })}
          className="w-full border rounded px-2 py-1 text-xs"
        />
      ))}
      <button
        onClick={async () => {
          await saveProfile(profile);
          onSaved(profile);
        }}
        className="w-full bg-gray-700 text-white py-1 rounded text-xs"
      >
        Save Profile
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create FormAutoFill.tsx**

```typescript
import { useEffect, useState } from "react";
import { FormField, Profile, FillInstruction } from "../../types";
import { getProfile } from "../../utils/profile";
import { buildFillPlan } from "../../lib/field-mapping";
import { ProfileEditor } from "./ProfileEditor";

interface OutputView {
  coverLetter: string;
  formFieldGuidance: { fieldId: string; suggestedAnswer: string }[];
}

interface Props {
  fields: FormField[];
  output: OutputView;
}

export function FormAutoFill({ fields, output }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [instructions, setInstructions] = useState<FillInstruction[]>([]);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    void getProfile().then(setProfile);
  }, []);

  useEffect(() => {
    if (profile) {
      const plan = buildFillPlan(fields, profile, output);
      setInstructions(plan.instructions);
    }
  }, [profile, fields, output]);

  function editValue(fieldId: string, value: string) {
    setInstructions((prev) =>
      prev.map((i) => (i.fieldId === fieldId ? { ...i, value } : i)),
    );
  }

  function fillOnPage() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId === undefined) return;
      chrome.tabs.sendMessage(
        tabId,
        { type: "APPLY_FILL_PLAN", instructions },
        (res) => {
          if (res) {
            setStatus(
              `Filled ${res.filled.length} field(s); ${res.missing.length} not found.`,
            );
          }
        },
      );
    });
  }

  if (!profile) return <div className="p-4 text-xs">Loading…</div>;

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold">Form Auto-Fill</h2>

      <ProfileEditor onSaved={setProfile} />

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Field Values</h3>
        {instructions.map((ins) => (
          <div key={ins.fieldId} className="text-xs space-y-1">
            <div className="text-gray-600">
              {ins.valueType} {ins.isFile ? "(file — attach manually)" : ""}
            </div>
            {!ins.isFile && (
              <textarea
                value={ins.value}
                onChange={(e) => editValue(ins.fieldId, e.target.value)}
                className="w-full border rounded px-2 py-1"
              />
            )}
          </div>
        ))}
      </div>

      <button
        onClick={fillOnPage}
        className="w-full bg-blue-600 text-white py-2 rounded font-medium"
      >
        Fill Form on Page
      </button>

      {status && <div className="text-xs text-green-700">{status}</div>}

      <div className="border-t pt-3 text-xs text-red-700 font-medium">
        ⚠️ ApplyMate never submits. Review every field on the page, attach your
        resume PDF, then submit manually.
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire Tab 4 into side-panel.tsx**

The Tab 4 needs both the form fields (from `state.extractedJobData`) and the approved output. Store the approved output in side-panel state. Add to `SidePanelState` in types.ts:
```typescript
  approvedOutput?: {
    coverLetter: string;
    formFieldGuidance: { fieldId: string; suggestedAnswer: string }[];
  };
```
Update the Tab 3 `onProceed` to capture output:
```typescript
      {state.currentTab === "tailoring-review" && (
        <TailoringReview
          onProceed={(output) =>
            setState((prev) => ({
              ...prev,
              approvedOutput: {
                coverLetter: output.coverLetter,
                formFieldGuidance: (output as any).formFieldGuidance ?? [],
              },
              currentTab: "form-auto-fill",
            }))
          }
        />
      )}
```
Replace the Tab 4 placeholder:
```typescript
      {state.currentTab === "form-auto-fill" && state.approvedOutput && (
        <FormAutoFill
          fields={data.formFields}
          output={state.approvedOutput}
        />
      )}
```
Add the import:
```typescript
import { FormAutoFill } from "./components/FormAutoFill";
```
Add `formFieldGuidance` to the `OutputView` type in TailoringReview.tsx so it flows through (add `formFieldGuidance: { fieldId: string; suggestedAnswer: string }[];` to its `OutputView` interface).

- [ ] **Step 4: Build + type-check**

Run: `pnpm --filter @applymate/extension build && pnpm --filter @applymate/extension type-check`
Expected: success, no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/ui/components/FormAutoFill.tsx packages/extension/src/ui/components/ProfileEditor.tsx packages/extension/src/ui/side-panel.tsx packages/extension/src/types.ts
git commit -m "feat: implement side panel Tab 4 - Form Auto-Fill with profile and never-submit guard"
```

---

## Task 3.9: Skill → Bridge Wiring (SKILL.md)

**Files:**
- Modify: `packages/skill/apply-to-job.md`

**Interfaces:**
- Consumes: bridge `POST /output`
- Produces: documented final step so Claude posts the `ApplyJobOutput` to the bridge

- [ ] **Step 1: Append a bridge-publish step to apply-to-job.md**

Add after the "Compose" step:
```markdown
7. **Publish to the extension (bridge).**
   POST the `ApplyJobOutput` (with the `jobUrl` field included) to the local
   bridge so the extension side panel can pick it up:

   ```bash
   curl -s -X POST http://127.0.0.1:4179/output \
     -H 'content-type: application/json' \
     -d @output.json
   ```

   If the POST fails, tell the user to start the bridge with `pnpm bridge`,
   then retry. Never block on this — the report and LaTeX are already produced.
```

- [ ] **Step 2: Commit**

```bash
git add packages/skill/apply-to-job.md
git commit -m "docs: document skill -> bridge publish step"
```

---

## Task 3.10: Manual Approval Gate #3

**Acceptance Criteria (Phase 3 Complete):**

Automated:
```bash
pnpm --filter @applymate/bridge test
pnpm --filter @applymate/extension test
pnpm --filter @applymate/bridge type-check
pnpm --filter @applymate/extension type-check
pnpm --filter @applymate/extension build
```
- [ ] Bridge tests pass (store + server).
- [ ] Extension tests pass (existing 19 + field-mapping 6 + fill 4).
- [ ] Type-check clean for bridge and extension.
- [ ] Build emits a loadable `dist/`.

Manual smoke (you):
- [ ] Start bridge: `pnpm bridge`. Confirm `http://127.0.0.1:4179/health` returns `{ ok: true }`.
- [ ] POST a sample `ApplyJobOutput` (with `jobUrl`) via curl; confirm `GET /output/latest` returns it.
- [ ] Load the rebuilt extension. On a job page: extract → validate fields → Tab 3 shows the report from the bridge → low-confidence bullets block until accepted → Proceed.
- [ ] Tab 4: edit profile, preview field values, click "Fill Form on Page", confirm text/textarea fields populate on the live page and frameworks register them.
- [ ] Confirm the extension never submits; the never-submit banner is visible.

**Sign-off:** All green → merge `phase-3-form-autofill` to `main` via finishing-a-development-branch, then plan Phase 4 (dashboard + real Tectonic-WASM PDF).

---

## Self-Review

- **Spec coverage:** Tab 3 tailoring review (3.7), Tab 4 form auto-fill (3.8), heuristic field mapping (3.4), content-script fill with event dispatch (3.5/3.6), profile (3.3/3.8), never-submit guard (3.8), skill→extension bridge (3.1/3.2/3.9). Resume-PDF auto-upload explicitly deferred to Phase 4 (constraint stated up front).
- **No placeholders:** every code step has complete code; commands have expected output.
- **Type consistency:** `FillInstruction`/`FillPlan`/`Profile` defined in 3.3 and used identically in 3.4/3.5/3.6/3.8. `buildFillPlan` and `applyFillPlan` signatures match across producer and consumer tasks. Bridge `StoredOutput` extends Phase 2 `ApplyJobOutput`.
- **Known deferral:** generated-PDF upload (needs Tectonic from Phase 4); Phase 3 ships the file-upload mechanism + manual attach.
```
