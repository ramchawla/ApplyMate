# ApplyMate Phase 5: Polish, E2E, Hardening — Implementation Plan

> **For agentic workers:** RECOMMENDED SUB-SKILL: Use `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Finish the MVP: keyboard shortcut to trigger extraction, an end-to-end integration test across the extension pipeline, graceful error/empty UI states, a resume-accuracy guard test, and clear run-everything docs. Verify the real browser PDF compile during the gate.

**Architecture:** No new subsystems. Hardens existing packages. The extension gets a `commands` shortcut + a jsdom integration test that runs detect → extract → field-map → fill end-to-end. UI gains bridge-down / extraction-failed states. The skill gains a guard test proving an unsupported keyword can never pass validation regardless of how it is proposed.

**Tech Stack:** Existing (TypeScript, React, Vitest, jsdom). Playwright (already available) is used interactively at the gate to confirm the SwiftLaTeX PDF compile — not as a committed test (browser-extension E2E is too flaky to codify).

## Global Constraints

- No new runtime dependencies.
- Keyboard shortcut must not conflict with common browser shortcuts; default `Ctrl+Shift+Y` (Chrome reserves `Ctrl+Shift+A`).
- Error states never fail silently — every failure path shows a message + a recovery hint.
- Resume-accuracy guard is the capstone safety test: it must prove the validator blocks hallucinations.
- TDD where there is logic; UI-only and docs tasks build/commit without a unit test.

## Prerequisites

- [ ] New branch off `main`: `git checkout -b phase-5-polish`.

---

## FILE STRUCTURE

```
packages/extension/
├── public/manifest.json            # MODIFY — add commands
├── src/background.ts               # MODIFY — handle command -> extract
├── src/ui/components/
│   └── BridgeStatus.tsx            # NEW — bridge up/down indicator
└── src/ui/side-panel.tsx           # MODIFY — extraction-failed state

tests/extension/
└── pipeline.e2e.test.ts            # NEW — detect->extract->map->fill (jsdom)

tests/skill/
└── accuracy-guard.test.ts          # NEW — hallucination cannot pass

README.md                            # MODIFY — run-everything quickstart
```

---

## Task 5.1: Keyboard Shortcut

**Files:**
- Modify: `packages/extension/public/manifest.json`
- Modify: `packages/extension/src/background.ts`

**Interfaces:**
- Consumes: `chrome.commands`
- Produces: `Ctrl+Shift+Y` / `Cmd+Shift+Y` triggers extraction on the active tab

- [ ] **Step 1: Add a commands block to manifest.json**

Add this top-level key to `packages/extension/public/manifest.json` (after `"action"`):
```json
  "commands": {
    "trigger-extract": {
      "suggested_key": {
        "default": "Ctrl+Shift+Y",
        "mac": "Command+Shift+Y"
      },
      "description": "Extract job data and open ApplyMate"
    }
  },
```

- [ ] **Step 2: Handle the command in background.ts**

Add this listener near the other `chrome.runtime` listeners in `packages/extension/src/background.ts`:
```typescript
chrome.commands?.onCommand.addListener((command) => {
  if (command !== "trigger-extract") return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (tabId === undefined) return;
    chrome.tabs.sendMessage(tabId, { type: "EXTRACT_JOB_DATA" }, () => {
      void chrome.runtime.lastError; // ignore if no content script on page
    });
    void openSidePanel();
  });
});
```

- [ ] **Step 3: Build + type-check**

Run: `pnpm --filter @applymate/extension build && pnpm --filter @applymate/extension type-check`
Expected: success, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/extension/public/manifest.json packages/extension/src/background.ts
git commit -m "feat: add keyboard shortcut to trigger extraction"
```

---

## Task 5.2: Extension Pipeline Integration Test

**Files:**
- Create: `tests/extension/pipeline.e2e.test.ts`

**Interfaces:**
- Consumes: `detect`, `extractJD`, `extractFormFields`, `buildFillPlan`, `applyFillPlan`
- Produces: one test proving the whole extension pipeline wires together on a realistic job-page DOM

- [ ] **Step 1: Write the integration test**

```typescript
import { describe, it, expect } from "vitest";
import { detect } from "../../packages/extension/src/content/detectors/index";
import {
  extractJD,
  extractFormFields,
} from "../../packages/extension/src/content/extractors/index";
import { buildFillPlan } from "../../packages/extension/src/lib/field-mapping";
import { applyFillPlan } from "../../packages/extension/src/content/fill";
import type { Profile } from "../../packages/extension/src/types";

const JOB_HTML = `
  <html><body>
    <h1>Senior Rust Engineer</h1>
    <p>Company: Acme Corp</p>
    <div class="posting-description">
      We need 5+ years of async Rust and systems programming.
    </div>
    <form>
      <label for="name">Full Name</label>
      <input id="name" type="text" />
      <label for="email">Email</label>
      <input id="email" type="email" />
      <label for="why">Why are you interested?</label>
      <textarea id="why"></textarea>
      <label for="resume">Resume</label>
      <input id="resume" type="file" />
    </form>
  </body></html>
`;

const profile: Profile = {
  fullName: "Jane Dev",
  email: "jane@example.com",
  phone: "555",
  linkedin: "",
  github: "",
  website: "",
};

const output = {
  coverLetter: "Dear Acme Corp...",
  formFieldGuidance: [
    { fieldId: "why", suggestedAnswer: "Your systems focus matches mine." },
  ],
};

describe("extension pipeline E2E", () => {
  it("detects, extracts, maps, and fills a realistic job page", () => {
    // detect (DOM fallback path)
    const detection = detect({ url: "https://careers.acme.com/x", html: JOB_HTML });
    expect(["linkedin", "generic"]).toContain(detection.board);

    // extract JD + fields
    const jd = extractJD(JOB_HTML, detection.board);
    expect(jd.jobTitle).toContain("Senior Rust Engineer");

    const fields = extractFormFields(JOB_HTML);
    const byType = (t: string) =>
      fields.find((f) => f.extractedValueType === t);
    expect(byType("name")).toBeTruthy();
    expect(byType("email")).toBeTruthy();
    expect(byType("custom-q")).toBeTruthy();

    // validate all fields (user gate) then build the plan
    fields.forEach((f) => (f.validated = true));
    const plan = buildFillPlan(fields, profile, output);
    expect(plan.instructions.find((i) => i.fieldId === "name")?.value).toBe(
      "Jane Dev",
    );
    expect(plan.instructions.find((i) => i.fieldId === "why")?.value).toBe(
      "Your systems focus matches mine.",
    );

    // apply to a live DOM
    const doc = new DOMParser().parseFromString(JOB_HTML, "text/html");
    const result = applyFillPlan(plan.instructions, doc);
    expect((doc.getElementById("name") as HTMLInputElement).value).toBe(
      "Jane Dev",
    );
    expect((doc.getElementById("email") as HTMLInputElement).value).toBe(
      "jane@example.com",
    );
    expect(result.filled).toContain("why");
    // resume is a file field -> not auto-filled
    expect(result.filled).not.toContain("resume");
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @applymate/extension test pipeline`
Expected: PASS (1 test).

- [ ] **Step 3: Commit**

```bash
git add tests/extension/pipeline.e2e.test.ts
git commit -m "test: end-to-end extension pipeline integration (detect->fill)"
```

---

## Task 5.3: Error / Empty UI States

**Files:**
- Create: `packages/extension/src/ui/components/BridgeStatus.tsx`
- Modify: `packages/extension/src/ui/components/TailoringReview.tsx`

**Interfaces:**
- Consumes: `isBridgeUp`
- Produces: a visible bridge up/down indicator on the Tailoring Review tab

- [ ] **Step 1: Create BridgeStatus.tsx**

```tsx
import { useEffect, useState } from "react";
import { isBridgeUp } from "../../utils/bridge";

export function BridgeStatus() {
  const [up, setUp] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    const check = async () => {
      const ok = await isBridgeUp();
      if (active) setUp(ok);
    };
    void check();
    const id = setInterval(check, 3000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  if (up === null) return null;

  return (
    <div
      className={`text-xs px-2 py-1 rounded ${
        up ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
      }`}
    >
      {up ? "● Bridge connected" : "● Bridge offline — run `pnpm bridge`"}
    </div>
  );
}
```

- [ ] **Step 2: Show the indicator in TailoringReview's waiting state**

In `packages/extension/src/ui/components/TailoringReview.tsx`, import and render `BridgeStatus` inside the `loading || !output` block, above `<BridgeTokenField />`:
```tsx
import { BridgeStatus } from "./BridgeStatus";
```
```tsx
        <BridgeStatus />
        <BridgeTokenField />
```

- [ ] **Step 3: Build + type-check**

Run: `pnpm --filter @applymate/extension build && pnpm --filter @applymate/extension type-check`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add packages/extension/src/ui/components/BridgeStatus.tsx packages/extension/src/ui/components/TailoringReview.tsx
git commit -m "feat: bridge connection status indicator"
```

---

## Task 5.4: Resume-Accuracy Guard Test

**Files:**
- Create: `tests/skill/accuracy-guard.test.ts`

**Interfaces:**
- Consumes: `validateRewrite`, `buildReport`, `parseJD`
- Produces: the capstone safety test — an unsupported keyword cannot pass, and a clean rewrite does

- [ ] **Step 1: Write the guard test**

```typescript
import { describe, it, expect } from "vitest";
import { validateRewrite, buildReport } from "../../packages/skill/src/stages/rewrite";
import { parseJD } from "../../packages/skill/src/stages/parse-jd";
import type { ExperienceAnchor } from "../../packages/skill/src/types";

const anchors: ExperienceAnchor[] = [
  {
    id: "rust",
    title: "Rust services",
    description: "",
    skills: ["rust", "async"],
    metrics: ["10k req/s"],
    tags: ["backend"],
    claimAnchor: "async Rust",
  },
];
const jd = parseJD("Senior Rust Engineer with Kubernetes.");

describe("resume accuracy guard", () => {
  it("blocks an unsupported keyword no matter how it is proposed", () => {
    // Try several phrasings that all attempt to inject 'kubernetes'.
    const attempts = [
      "Built Rust services, deployed on Kubernetes",
      "Operated Kubernetes clusters for Rust apps",
      "Kubernetes-native Rust microservices",
    ];
    for (const revised of attempts) {
      const r = validateRewrite(
        {
          original: "Built Rust services, 10k req/s",
          revised,
          keywordsAdded: ["kubernetes"],
          reasonsForAddition: ["jd asked"],
        },
        anchors,
        jd,
      );
      expect(r.invariantChecksPassed).toBe(false);
      expect(r.plausibilityScore).toBe(0.5);
    }
  });

  it("preserves metrics — altering a number fails", () => {
    const r = validateRewrite(
      {
        original: "Built Rust services, 10k req/s",
        revised: "Built async Rust services, 50k req/s",
        keywordsAdded: ["async"],
        reasonsForAddition: ["supported"],
      },
      anchors,
      jd,
    );
    expect(r.invariantChecksPassed).toBe(false);
  });

  it("accepts a fully supported rewrite", () => {
    const r = validateRewrite(
      {
        original: "Built Rust services, 10k req/s",
        revised: "Built async Rust services, 10k req/s",
        keywordsAdded: ["async"],
        reasonsForAddition: ["supported by corpus"],
      },
      anchors,
      jd,
    );
    expect(r.invariantChecksPassed).toBe(true);
    const report = buildReport([r]);
    expect(report.allInvariantChecksPassed).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @applymate/skill test accuracy-guard`
Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add tests/skill/accuracy-guard.test.ts
git commit -m "test: resume-accuracy guard proves hallucinations are blocked"
```

---

## Task 5.5: Run-Everything Quickstart

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing
- Produces: a single "Running the whole thing" section

- [ ] **Step 1: Add a Quickstart section near the top of README.md**

Insert after the Overview section:
```markdown
## Quickstart (local, all parts)

```bash
pnpm install

# 1. Vector DB (Docker) for the skill
pnpm skill:db:up

# 2. Bridge (prints a token; also saved to ~/.applymate/bridge-token)
pnpm bridge

# 3. Dashboard
pnpm --filter @applymate/dashboard dev    # http://localhost:3001

# 4. Extension: build, then load packages/extension/dist as an unpacked
#    extension at chrome://extensions (Developer mode).
pnpm build:extension
```

Then on a job page: trigger ApplyMate (toolbar icon or Ctrl/Cmd+Shift+Y) →
validate fields → run `/apply-to-job` in Claude Code (posts to the bridge) →
review the report → auto-fill → review → submit manually. Paste the bridge
token into the side panel once. Tests: `pnpm -r test`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add run-everything quickstart"
```

---

## Task 5.6: Manual Approval Gate #5 (Final)

**Acceptance Criteria (Phase 5 / MVP complete):**

Automated:
```bash
pnpm --filter @applymate/extension test
pnpm --filter @applymate/skill test
pnpm --filter @applymate/bridge test
pnpm --filter @applymate/dashboard test
pnpm --filter @applymate/extension type-check
pnpm --filter @applymate/extension build
```
- [ ] Extension tests pass (incl. new pipeline E2E).
- [ ] Skill tests pass (incl. accuracy guard).
- [ ] Bridge + dashboard tests pass.
- [ ] Extension builds; manifest includes the `commands` shortcut.

Browser verification (driven via Playwright at the gate):
- [ ] Start the dashboard, seed one version via the bridge, open `/resumes/<id>`, click **Compile PDF (client-side)**, confirm a PDF renders. This closes the only previously-unverified path (SwiftLaTeX WASM in a real browser).

Manual (you):
- [ ] Load the rebuilt extension; confirm `Ctrl/Cmd+Shift+Y` triggers extraction and opens the side panel.
- [ ] Bridge-offline shows the red indicator; starting it flips to green.

**Sign-off:** All green → merge `phase-5-polish` to `main`. MVP complete across all five phases.

---

## Self-Review

- **Spec coverage:** keyboard shortcut (5.1), E2E (5.2), error/empty states (5.3), resume-accuracy validation (5.4), docs (5.5), browser PDF-compile verification (5.6 gate). The Phase 5 spec items (shortcuts, better error handling, E2E, accuracy) all map to tasks.
- **No placeholders:** all code complete; commands have expected output.
- **Type consistency:** reuses existing `Profile`, `FormField`, `ExperienceAnchor`, `validateRewrite`/`buildReport` signatures unchanged.
- **Known risk:** browser-extension E2E is intentionally NOT codified (flaky); covered by the jsdom pipeline test plus a one-time Playwright check at the gate.
```
