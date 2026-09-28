# One-Click Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One click on a job application page fills every standard field instantly, then attaches a Claude-tailored one-page resume PDF, a cover letter, and custom-question answers ~30-60s later — never submitting.

**Architecture:** The Chrome MV3 content script (classic IIFE bundle, every frame) extracts fields from the live DOM, fills profile values instantly, and asks the background worker to proxy an async `POST /tailor` job to the localhost bridge. The bridge runs `claude -p` (headless Claude Code on the user's subscription, schema-validated JSON), splices ID-addressed edits into `resume-master.tex`, runs warn-only checks, compiles with tectonic (pdfLaTeX-compat shim), fits to one page, persists, and serves the PDFs back for `DataTransfer` attachment.

**Tech Stack:** TypeScript (strict), Node ≥22 (`node:sqlite`), pnpm workspaces, vitest + jsdom, Vite (React side panel + IIFE content build), tectonic 0.16, Claude Code CLI 2.1.x, `yaml`.

**Spec:** `docs/superpowers/specs/2026-09-28-one-click-core-design.md`

## Global Constraints

- ApplyMate never clicks or triggers a site's submit. It only detects the user's own submit click.
- Zero Anthropic API usage: generation only via `claude -p` on the user's subscription. Never use `--bare` (it forces `ANTHROPIC_API_KEY`), never require an API key.
- `claude -p` isolation: `--tools "" --no-session-persistence --setting-sources project --strict-mcp-config --system-prompt …` with env `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1 CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, cwd `~/.applymate` (verified: no user CLAUDE.md/hooks leak, ~550 input tokens overhead).
- Model: `APPLYMATE_MODEL` env, default `sonnet`. CLI timeout 180s.
- Checks are **warn-only** (judgment-led). The only reverting check is LaTeX that would break compilation; page overflow reverts largest-growth edits.
- `~/.applymate/resume-master.tex` is read-only to ApplyMate. Names, contact, companies, titles, dates, education are never exposed for editing.
- Bridge binds `127.0.0.1` only; every route except `/health` and `/pair` requires the bearer token; CORS reflects only `chrome-extension://` origins; loopback Host check stays.
- Content script is a classic script: `dist/content.js` must contain no top-level `import`.
- All data stays local under `~/.applymate/`.
- TS strict with `noUnusedLocals`/`noUnusedParameters`; tests are vitest under `tests/<package>/`.

## Review Focus

- **JD missing on the form page** (Lever `/apply`, Ashby `/application`, embedded Greenhouse iframe): the JD cached from the posting page (or the most recent within 30 min) must be used — `jobKey`/`pickJD` tests in Task 11.
- **Option text that doesn't literally equal the profile value** ("Decline to self-identify" vs "I don't wish to answer", "Yes" vs "Yes, I am authorized", "No" vs "Not a veteran"): `matchOption` tests in Task 10.
- **Claude returns LaTeX that breaks compilation or overflows one page**: revert + fallback-to-master tests in Task 5.
- **Bridge restarted / token changed / bridge offline**: `bridgeFetch` re-pair-on-401 test in Task 11; widget shows offline and still instant-fills (Task 12).
- **Non-application forms** (newsletter, search, login) must not show the widget or mark anything applied: `isApplicationForm`/`isSubmitControl` tests in Task 12.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/local/compile-latex.ts` (M) | tectonic compile + pdfLaTeX-compat shim + page count |
| `lib/shared/types.ts` (M) | `FormField` widened; `TailorRequest`, `TailorResult`, `RunReport` |
| `lib/shared/constants.ts` (M) | field keyword table, autocomplete map, long-label types |
| `packages/skill/src/tailor/resume-doc.ts` (C) | parse master `.tex` into ID-addressed parts; render with edits/order |
| `packages/skill/src/tailor/checks.ts` (C) | LaTeX safety, metric/seniority/keyword warnings |
| `packages/skill/src/tailor/claude-cli.ts` (C) | spawn `claude -p`, parse structured output |
| `packages/skill/src/tailor/prompt.ts` (C) | system rules, JSON schema, prompt builder, output normalizer |
| `packages/skill/src/tailor/letter.ts` (C) | cover-letter `.tex`, profile name |
| `packages/skill/src/tailor/run.ts` (C) | orchestrate: Claude → checks → render → compile → page-fit |
| `packages/bridge/src/jobs.ts` (C) | FIFO job queue |
| `packages/bridge/src/tailor-job.ts` (C) | glue: read `~/.applymate` files, run tailor, persist, file name |
| `packages/bridge/src/persist.ts` (M) | app dir naming, file save, `markApplied` |
| `packages/bridge/src/server.ts` (M) | `/pair`, `/tailor`, `/tailor/:id[/…pdf]`, `/profile`, `/applications/applied` |
| `packages/bridge/src/start.ts` (M) | persistent token, wire tailor job |
| `packages/bridge/src/profile-init.ts` (C) | build `profile.yaml` from corpus + resume |
| `packages/bridge/src/install-launchd.ts` (C) | launchd agent plist + load |
| `packages/bridge/src/smoke.ts` (C) | real end-to-end smoke run |
| `packages/extension/src/content/dom.ts` (C) | DOM helpers (native setters, events, escape, attr) |
| `packages/extension/src/content/extractors/form.ts` (rewrite) | live-DOM field extraction, labels, type inference |
| `packages/extension/src/content/fill.ts` (rewrite) | fill text/select/radio/checkbox/combobox/radiogroup, attach file, highlight |
| `packages/extension/src/lib/field-mapping.ts` (rewrite) | profile → field values, answer rules, instant plan |
| `packages/extension/src/lib/jd-cache.ts` (C) | job key, JD cache, JD source selection |
| `packages/extension/src/utils/profile.ts` (M) | nested profile normalize/get/save |
| `packages/extension/src/utils/bridge.ts` (rewrite) | pairing + authed fetch |
| `packages/extension/src/background.ts` (rewrite) | message proxy to bridge |
| `packages/extension/src/content/widget.ts` (C) | shadow-DOM widget |
| `packages/extension/src/content/content.ts` (rewrite) | gating, one-click orchestration, submit detection |
| `packages/extension/vite.content.config.ts` (C) | IIFE content build |
| `packages/extension/src/ui/side-panel.tsx` (rewrite) | pairing, last-run details, paste JD |

---

### Task 1: tectonic compat shim + page count

**Files:**
- Modify: `lib/local/compile-latex.ts`
- Create: `tests/skill/fixtures/resume-master.tex`
- Test: `tests/dashboard/compile-latex.test.ts`

**Interfaces:**
- Produces: `toTectonicCompat(tex: string): string`, `parsePageCount(log: string): number`, `compileLatexWithPages(latex: string, binary?: string): Promise<{ pdf: Buffer; pages: number }>`, `compileLatex(latex, binary?) : Promise<Buffer>` (unchanged signature).

Root cause being fixed: the master resume is pdfLaTeX-flavoured (Overleaf). Tectonic runs XeTeX: `\input{glyphtounicode}`/`\pdfgentounicode` are undefined there, and `fontawesome5`'s XeTeX path aborts tectonic 0.16 (exit 134). Loading the FontAwesome OTFs by filename through `fontspec` works (verified).

- [ ] **Step 1: Create the fixture resume**

Build `tests/skill/fixtures/resume-master.tex` = lines 1–111 of `~/.applymate/resume-master.tex` (the MIT template preamble; contains no personal data — verified) followed by this synthetic body:

```bash
sed -n 1,111p ~/.applymate/resume-master.tex > tests/skill/fixtures/resume-master.tex
cat >> tests/skill/fixtures/resume-master.tex <<'EOF'
\begin{document}
\begin{center}
    \href{https://example.com}{\textbf{\Huge \scshape Jane Dev}} \\ \vspace{1pt}
    \href{mailto:jane@example.com}{\seticon{faEnvelope} \underline{jane@example.com}} \quad
    \href{https://github.com/janedev}{\seticon{faGithub} \underline{github.com/janedev}}
\end{center}

\section{Summary}
\vspace{2pt}
\small{Backend engineer with 5+ years building \textbf{distributed systems} and \textbf{CI/CD} platforms.}
\vspace{-4pt}

\section{Education}
    \resumeSubHeadingListStart
    \resumeSubheading
    {State University}{2014 -- 2018}
    {B.Sc., \textbf{Computer Science} (major)}{}
    \resumeItemListStart
        \resumeItem{Dean's list}
    \resumeItemListEnd
    \resumeSubHeadingListEnd

\section{Experience}
\resumeSubHeadingListStart

    \resumeOrgHeading
    {Acme Corp}{Toronto, Ontario}
    \resumeSubSubheading
    {Senior Software Engineer}{May 2022 -- Present}
    \resumeItemListStart
        \resumeItem{Built a \textbf{Rust} HTTP service handling \textbf{10k req/s} at \textbf{100ms} p99.}
        \resumeItem{Cut CI time by \textbf{40\%} with parallel \textbf{GitHub Actions} jobs.}
        % \resumeItem{Old commented bullet {with braces}.}
    \resumeItemListEnd

    \resumeSubSubheadingSpaced
    {Software Engineer}{Jun 2018 -- Apr 2022}
    \resumeItemListStart
        \resumeItem{Migrated \textbf{15+ services} to \textbf{Kubernetes}.}
    \resumeItemListEnd

\resumeSubHeadingListEnd

\section{Projects}
\resumeSubHeadingListStart
    \resumeProjectHeading
    {\textbf{Widget} $|$ \emph{Go, Redis}}
    \resumeItemListStart
        \resumeItem{Shipped a \textbf{Go} job queue over \textbf{Redis} processing \textbf{\$1M} in orders.}
    \resumeItemListEnd
\resumeSubHeadingListEnd

\section{Technical Skills}
    \begin{itemize}[leftmargin=0.15in, label={}]
    \small{\item{
        \textbf{Languages}{: Rust, Go, Python} \\
        \textbf{Technologies}{: Kubernetes, Redis, GitHub Actions}
    }}
    \end{itemize}
\end{document}
EOF
grep -c -i 'chawla\|rbc' tests/skill/fixtures/resume-master.tex   # expect 0
```

- [ ] **Step 2: Write failing tests** — append to `tests/dashboard/compile-latex.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  compileLatexWithPages,
  toTectonicCompat,
  parsePageCount,
} from "../../lib/local/compile-latex";

const FIXTURE = fileURLToPath(
  new URL("../skill/fixtures/resume-master.tex", import.meta.url),
);

describe("toTectonicCompat", () => {
  it("strips pdfTeX-only glyphtounicode lines", () => {
    const out = toTectonicCompat(
      "\\input{glyphtounicode}\n\\pdfgentounicode=1\n\\begin{document}",
    );
    expect(out).not.toContain("glyphtounicode");
    expect(out).not.toContain("pdfgentounicode");
    expect(out).toContain("\\begin{document}");
  });

  it("swaps fontawesome5 for a fontspec shim that defines the icons", () => {
    const out = toTectonicCompat("\\usepackage{fontawesome5}\n");
    expect(out).not.toContain("{fontawesome5}");
    expect(out).toContain("\\usepackage{fontspec}");
    expect(out).toContain("\\providecommand{\\faGithub}");
    expect(out).toContain("\\providecommand{\\faEnvelope}");
  });

  it("leaves other documents unchanged", () => {
    const tex = "\\documentclass{article}\\begin{document}x\\end{document}";
    expect(toTectonicCompat(tex)).toBe(tex);
  });
});

describe("parsePageCount", () => {
  it("reads the page count from the XeTeX log", () => {
    expect(parsePageCount("Output written on resume.xdv (2 pages, 1234 bytes).")).toBe(2);
    expect(parsePageCount("Output written on resume.xdv (1 page, 99 bytes).")).toBe(1);
    expect(parsePageCount("")).toBe(0);
  });
});

describe("compileLatexWithPages", () => {
  it("compiles a pdfLaTeX-style resume (fontawesome5 + glyphtounicode) to one page", async () => {
    if (!(await hasTectonic())) return;
    const { pdf, pages } = await compileLatexWithPages(readFileSync(FIXTURE, "utf8"));
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pages).toBe(1);
  }, 180000);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @applymate/dashboard exec vitest run ../../tests/dashboard/compile-latex.test.ts` (fall back to `cd packages/dashboard && npx vitest run ../../tests/dashboard/compile-latex.test.ts` if the filter form doesn't resolve)
Expected: FAIL — `toTectonicCompat` is not exported.

- [ ] **Step 4: Implement** — replace `lib/local/compile-latex.ts` with:

```ts
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

export interface CompileResult {
  pdf: Buffer;
  pages: number;
}

// FontAwesome 5 codepoints for icons resume headers commonly use.
const FA_SOLID: Record<string, string> = {
  faEnvelope: "F0E0",
  faLink: "F0C1",
  faPhone: "F095",
  faMobile: "F3CD",
  faGlobe: "F0AC",
  faMapMarker: "F3C5",
};
const FA_BRANDS: Record<string, string> = {
  faLinkedin: "F08C",
  faLinkedinIn: "F0E1",
  faGithub: "F09B",
  faTwitter: "F099",
};

const FA_SHIM = [
  "\\usepackage{fontspec}",
  "\\newfontfamily\\AMfaSolid{FontAwesome5Free-Solid-900.otf}",
  "\\newfontfamily\\AMfaBrands{FontAwesome5Brands-Regular-400.otf}",
  ...Object.entries(FA_SOLID).map(
    ([name, cp]) => `\\providecommand{\\${name}}{{\\AMfaSolid\\symbol{"${cp}}}}`,
  ),
  ...Object.entries(FA_BRANDS).map(
    ([name, cp]) => `\\providecommand{\\${name}}{{\\AMfaBrands\\symbol{"${cp}}}}`,
  ),
].join("\n");

// Tectonic runs XeTeX. Resumes written for pdfLaTeX (Overleaf) use
// glyphtounicode/\pdfgentounicode (pdfTeX primitives; XeTeX emits Unicode
// text natively, so dropping them is safe) and fontawesome5, whose XeTeX path
// aborts tectonic 0.16 (exit 134). Swap in a fontspec shim loading the
// FontAwesome OTFs by filename.
export function toTectonicCompat(tex: string): string {
  return tex
    .replace(/^[ \t]*\\input\{glyphtounicode\}.*$/gm, "")
    .replace(/^[ \t]*\\pdfgentounicode\s*=\s*1.*$/gm, "")
    .replace(/\\usepackage(\[[^\]]*\])?\{fontawesome5\}/, () => FA_SHIM);
}

// XeTeX logs "Output written on x.xdv (N pages, …)". PDF bytes can't be
// counted directly: tectonic packs page objects into compressed streams.
export function parsePageCount(log: string): number {
  const m = log.match(/Output written on [^(]*\((\d+) pages?/);
  return m ? Number(m[1]) : 0;
}

export async function compileLatexWithPages(
  latex: string,
  binary = "tectonic",
): Promise<CompileResult> {
  const dir = await mkdtemp(join(tmpdir(), "applymate-tex-"));
  const texPath = join(dir, "resume.tex");
  try {
    await writeFile(texPath, toTectonicCompat(latex), "utf8");
    await runTectonic(binary, texPath, dir);
    const pdf = await readFile(join(dir, "resume.pdf"));
    const log = await readFile(join(dir, "resume.log"), "utf8").catch(() => "");
    return { pdf, pages: parsePageCount(log) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function compileLatex(
  latex: string,
  binary = "tectonic",
): Promise<Buffer> {
  return (await compileLatexWithPages(latex, binary)).pdf;
}

function runTectonic(binary: string, texPath: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      ["--keep-logs", texPath],
      { cwd, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (!err) return resolve();
        const e = err as NodeJS.ErrnoException;
        if (e.code === "ENOENT") return reject(new TectonicMissingError());
        reject(new Error(`tectonic failed:\n${String(stderr || stdout).slice(-2000)}`));
      },
    );
  });
}
```

- [ ] **Step 5: Run tests** — same command as Step 3. Expected: PASS (6 tests). If the real-compile test fails only inside the Claude Code sandbox, rerun unsandboxed; tectonic needs its cache dir.

- [ ] **Step 6: Commit**

```bash
git add lib/local/compile-latex.ts tests/dashboard/compile-latex.test.ts tests/skill/fixtures/resume-master.tex
git commit -m "fix: compile pdfLaTeX-style resumes under tectonic (compat shim) and count pages"
```

---

### Task 2: ID-addressed resume document

**Files:**
- Create: `packages/skill/src/tailor/resume-doc.ts`
- Test: `tests/skill/resume-doc.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface ResumePart { id: string; kind: "summary" | "bullet" | "skills"; start: number; end: number; text: string }
  interface ResumeGroup { id: string; heading: string; bulletIds: string[] }
  interface ResumeDoc { tex: string; parts: ResumePart[]; groups: ResumeGroup[] }
  parseResume(tex: string): ResumeDoc
  renderResume(doc: ResumeDoc, edits?: Record<string, string>, order?: Record<string, string[]>): string
  isPermutation(a: string[], b: string[]): boolean
  matchBrace(s: string, openIdx: number): number
  ```
  IDs: `summary`, `r<g>.b<i>` (groups numbered across Experience+Projects in document order), `skills.<slug(label)>`.

- [ ] **Step 1: Write failing tests** — `tests/skill/resume-doc.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseResume,
  renderResume,
  isPermutation,
  matchBrace,
} from "../../packages/skill/src/tailor/resume-doc";

const tex = readFileSync(
  fileURLToPath(new URL("./fixtures/resume-master.tex", import.meta.url)),
  "utf8",
);

describe("parseResume", () => {
  const doc = parseResume(tex);
  const ids = doc.parts.map((p) => p.id);

  it("exposes summary, bullets per role, and skills lines", () => {
    expect(ids).toEqual([
      "summary",
      "r0.b0",
      "r0.b1",
      "r1.b0",
      "r2.b0",
      "skills.languages",
      "skills.technologies",
    ]);
    expect(doc.parts.find((p) => p.id === "summary")!.text).toContain(
      "Backend engineer",
    );
    expect(doc.parts.find((p) => p.id === "skills.languages")!.text).toBe(
      "Rust, Go, Python",
    );
  });

  it("never exposes education or commented-out bullets", () => {
    const all = doc.parts.map((p) => p.text).join("\n");
    expect(all).not.toContain("Dean's list");
    expect(all).not.toContain("Old commented bullet");
  });

  it("gives each group a readable heading including the company", () => {
    expect(doc.groups.map((g) => g.id)).toEqual(["r0", "r1", "r2"]);
    expect(doc.groups[0].heading).toContain("Acme Corp");
    expect(doc.groups[0].heading).toContain("Senior Software Engineer");
    expect(doc.groups[1].heading).toContain("Acme Corp");
    expect(doc.groups[1].heading).toContain("Software Engineer");
    expect(doc.groups[2].heading).toContain("Widget");
    expect(doc.groups[0].bulletIds).toEqual(["r0.b0", "r0.b1"]);
  });
});

describe("renderResume", () => {
  const doc = parseResume(tex);

  it("round-trips byte-identically with no edits", () => {
    expect(renderResume(doc)).toBe(tex);
  });

  it("splices an edit into exactly its slot", () => {
    const out = renderResume(doc, { "r1.b0": "Moved \\textbf{15+ services} to K8s." });
    expect(out).toContain("\\resumeItem{Moved \\textbf{15+ services} to K8s.}");
    expect(out).not.toContain("Migrated \\textbf{15+ services}");
    expect(out.replace("Moved \\textbf{15+ services} to K8s.", "")).toBe(
      tex.replace("Migrated \\textbf{15+ services} to \\textbf{Kubernetes}.", ""),
    );
  });

  it("reorders bullets within a role", () => {
    const out = renderResume(doc, {}, { r0: ["r0.b1", "r0.b0"] });
    expect(out.indexOf("Cut CI time")).toBeLessThan(out.indexOf("Built a \\textbf{Rust}"));
  });

  it("ignores an order that is not a permutation of the role's bullets", () => {
    expect(renderResume(doc, {}, { r0: ["r0.b1", "r1.b0"] })).toBe(tex);
  });

  it("applies edits and order together", () => {
    const out = renderResume(doc, { "r0.b0": "EDITED" }, { r0: ["r0.b1", "r0.b0"] });
    expect(out.indexOf("Cut CI time")).toBeLessThan(out.indexOf("EDITED"));
  });
});

describe("helpers", () => {
  it("matchBrace skips escaped braces and percent", () => {
    const s = "{a \\{ b \\% {c}}";
    expect(matchBrace(s, 0)).toBe(s.length - 1);
  });
  it("isPermutation", () => {
    expect(isPermutation(["a", "b"], ["b", "a"])).toBe(true);
    expect(isPermutation(["a", "a"], ["a", "b"])).toBe(false);
    expect(isPermutation(["a"], ["a", "b"])).toBe(false);
  });
});

describe("real master resume (local only)", () => {
  const path = join(homedir(), ".applymate", "resume-master.tex");
  it.runIf(existsSync(path))("round-trips and exposes every bullet", () => {
    const real = readFileSync(path, "utf8");
    const doc = parseResume(real);
    expect(renderResume(doc)).toBe(real);
    const itemCount = (real.match(/^\s*\\resumeItem\{/gm) ?? []).length;
    const bullets = doc.parts.filter((p) => p.kind === "bullet").length;
    expect(bullets).toBe(itemCount - 1); // minus the education cert line
    expect(doc.parts.some((p) => p.id === "summary")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:skill -- resume-doc`
Expected: FAIL — cannot resolve `tailor/resume-doc`.

- [ ] **Step 3: Implement** — `packages/skill/src/tailor/resume-doc.ts`:

```ts
// Addressable view of the master resume: only the parts Claude may edit
// (summary, bullets, skills lines), with exact offsets so edits splice back
// into the untouched source. Preamble, header, headings, companies, titles,
// dates and education are never exposed, so they can't change.

export interface ResumePart {
  id: string;
  kind: "summary" | "bullet" | "skills";
  start: number;
  end: number;
  text: string;
}

export interface ResumeGroup {
  id: string;
  heading: string;
  bulletIds: string[];
}

export interface ResumeDoc {
  tex: string;
  parts: ResumePart[];
  groups: ResumeGroup[];
}

// Index of the "}" matching the "{" at openIdx. A backslash escapes the next
// char, so \{ \} \% never count.
export function matchBrace(s: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  throw new Error(`Unbalanced brace at offset ${openIdx}`);
}

function isCommented(s: string, idx: number): boolean {
  const lineStart = s.lastIndexOf("\n", idx - 1) + 1;
  return /(^|[^\\])%/.test(s.slice(lineStart, idx));
}

interface Section {
  name: string;
  start: number;
  end: number;
}

function sections(tex: string): Section[] {
  const found = [...tex.matchAll(/\\section\{([^}]*)\}/g)].filter(
    (m) => !isCommented(tex, m.index!),
  );
  const docEnd = tex.indexOf("\\end{document}");
  return found.map((m, i) => ({
    name: m[1],
    start: m.index!,
    end:
      i + 1 < found.length
        ? found[i + 1].index!
        : docEnd === -1
          ? tex.length
          : docEnd,
  }));
}

function readableHeading(src: string): string {
  return src
    .replace(/%.*$/gm, "")
    .replace(/\\(resumeSubHeadingListStart|resumeSubHeadingListEnd|vspace\{[^}]*\})/g, " ")
    .replace(/\}\s*\{/g, " | ")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/[{}$]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function parseResume(tex: string): ResumeDoc {
  const parts: ResumePart[] = [];
  const groups: ResumeGroup[] = [];
  const push = (id: string, kind: ResumePart["kind"], start: number, end: number) =>
    parts.push({ id, kind, start, end, text: tex.slice(start, end) });

  let lastTop = "";
  for (const sec of sections(tex)) {
    const name = sec.name.toLowerCase();

    if (/summary|profile|objective/.test(name)) {
      const k = tex.indexOf("\\small{", sec.start);
      if (k !== -1 && k < sec.end) {
        const open = k + "\\small".length;
        push("summary", "summary", open + 1, matchBrace(tex, open));
      }
      continue;
    }

    if (/skill/.test(name)) {
      const body = tex.slice(sec.start, sec.end);
      for (const m of body.matchAll(/\\textbf\{([^{}]+)\}\{/g)) {
        const open = sec.start + m.index! + m[0].length - 1;
        if (isCommented(tex, open)) continue;
        const close = matchBrace(tex, open);
        const lead = tex.slice(open + 1, close).match(/^:\s*/)?.[0].length ?? 0;
        push(`skills.${slug(m[1])}`, "skills", open + 1 + lead, close);
      }
      continue;
    }

    if (/education/.test(name)) continue;

    let cursor = sec.start + `\\section{${sec.name}}`.length;
    const listRe = /\\resumeItemListStart/g;
    listRe.lastIndex = cursor;
    let m: RegExpExecArray | null;
    while ((m = listRe.exec(tex)) && m.index < sec.end) {
      if (isCommented(tex, m.index)) continue;
      const listEnd = tex.indexOf("\\resumeItemListEnd", m.index);
      if (listEnd === -1 || listEnd > sec.end) break;

      const headSrc = tex.slice(cursor, m.index);
      let heading = readableHeading(headSrc);
      if (/\\resume(OrgHeading|Subheading|ProjectHeading)\b/.test(headSrc)) {
        lastTop = heading;
      } else if (lastTop) {
        heading = `${lastTop.split(" | ")[0]} — ${heading}`;
      }

      const group: ResumeGroup = { id: `r${groups.length}`, heading, bulletIds: [] };
      const itemRe = /\\resumeItem\{/g;
      itemRe.lastIndex = m.index;
      let it: RegExpExecArray | null;
      while ((it = itemRe.exec(tex)) && it.index < listEnd) {
        if (isCommented(tex, it.index)) continue;
        const open = it.index + it[0].length - 1;
        const close = matchBrace(tex, open);
        const id = `${group.id}.b${group.bulletIds.length}`;
        push(id, "bullet", open + 1, close);
        group.bulletIds.push(id);
        itemRe.lastIndex = close;
      }
      if (group.bulletIds.length > 0) groups.push(group);

      cursor = listEnd + "\\resumeItemListEnd".length;
      listRe.lastIndex = cursor;
    }
  }

  return { tex, parts, groups };
}

export function isPermutation(a: string[], b: string[]): boolean {
  return (
    a.length === b.length &&
    new Set(a).size === a.length &&
    [...a].sort().join("\n") === [...b].sort().join("\n")
  );
}

export function renderResume(
  doc: ResumeDoc,
  edits: Record<string, string> = {},
  order: Record<string, string[]> = {},
): string {
  const byId = new Map(doc.parts.map((p) => [p.id, p]));
  const content = (id: string) => edits[id] ?? byId.get(id)!.text;

  const replacement = new Map<string, string>();
  for (const p of doc.parts) replacement.set(p.id, content(p.id));
  for (const g of doc.groups) {
    const ids = order[g.id];
    if (!ids || !isPermutation(ids, g.bulletIds)) continue;
    g.bulletIds.forEach((slot, i) => replacement.set(slot, content(ids[i])));
  }

  let out = doc.tex;
  for (const p of [...doc.parts].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, p.start) + replacement.get(p.id)! + out.slice(p.end);
  }
  return out;
}
```

- [ ] **Step 4: Run tests** — `pnpm test:skill -- resume-doc`. Expected: PASS (including the local real-resume round-trip).

- [ ] **Step 5: Commit**

```bash
git add packages/skill/src/tailor/resume-doc.ts tests/skill/resume-doc.test.ts
git commit -m "feat: parse master resume into ID-addressed editable parts"
```

---

### Task 3: warn-only checks

**Files:**
- Create: `packages/skill/src/tailor/checks.ts`
- Test: `tests/skill/tailor-checks.test.ts`

**Interfaces:**
- Consumes: `extractMetrics`, `checkInvariants` from `packages/skill/src/validators/invariant-checks.ts`.
- Produces: `latexProblem(latex: string): string | null`, `editWarnings(id: string, before: string, after: string, groundMetrics: Set<string>): string[]`, `keywordWarnings(injected: { keyword: string; where: string }[], groundText: string): string[]`.

- [ ] **Step 1: Write failing tests** — `tests/skill/tailor-checks.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  latexProblem,
  editWarnings,
  keywordWarnings,
} from "../../packages/skill/src/tailor/checks";

describe("latexProblem", () => {
  it("accepts escaped specials and balanced braces", () => {
    expect(latexProblem("Cut \\textbf{40\\%} of \\$ spend \\& C\\# \\_x")).toBeNull();
  });
  it("flags unescaped specials", () => {
    expect(latexProblem("cut 40% of time")).toMatch(/unescaped %/);
    expect(latexProblem("R&D")).toMatch(/unescaped &/);
    expect(latexProblem("snake_case")).toMatch(/unescaped _/);
  });
  it("flags unbalanced braces", () => {
    expect(latexProblem("\\textbf{open")).toMatch(/unbalanced/);
    expect(latexProblem("close}")).toMatch(/unbalanced/);
  });
});

describe("editWarnings", () => {
  const ground = new Set(["500"]);
  it("warns on a new number not in the original or the corpus", () => {
    const w = editWarnings("r0.b0", "Cut CI by 40\\%", "Cut CI by 40\\% saving 30 hours", ground);
    expect(w.join()).toMatch(/possible invented metric 30/);
  });
  it("allows a new number that the corpus backs", () => {
    expect(editWarnings("r0.b0", "Served devs", "Served 500 devs", ground)).toEqual([]);
  });
  it("warns on a dropped metric", () => {
    expect(editWarnings("r0.b0", "Handled 10k req/s", "Handled heavy load", ground).join()).toMatch(
      /dropped metric 10k/,
    );
  });
  it("warns on seniority inflation", () => {
    expect(editWarnings("r0.b0", "Built tools", "Senior lead who built tools", ground).join()).toMatch(
      /seniority/,
    );
  });
});

describe("keywordWarnings", () => {
  it("flags keywords absent from corpus and master", () => {
    const w = keywordWarnings(
      [
        { keyword: "Kubernetes", where: "r1.b0" },
        { keyword: "Terraform", where: "r0.b1" },
      ],
      "skills: [kubernetes, go]",
    );
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/Terraform/);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm test:skill -- tailor-checks`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement** — `packages/skill/src/tailor/checks.ts`:

```ts
import { extractMetrics, checkInvariants } from "../validators/invariant-checks";

// The one hard check: output that would break compilation.
export function latexProblem(latex: string): string | null {
  let depth = 0;
  for (let i = 0; i < latex.length; i++) {
    const c = latex[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      if (--depth < 0) return "unbalanced braces";
    } else if ("%&$#_".includes(c)) {
      return `unescaped ${c}`;
    }
  }
  return depth === 0 ? null : "unbalanced braces";
}

// Judgment-led tailoring: these never block, they tell the user what to
// double-check before submitting.
export function editWarnings(
  id: string,
  before: string,
  after: string,
  groundMetrics: Set<string>,
): string[] {
  const inv = checkInvariants({
    original: before,
    revised: after,
    addedKeywords: [],
    anchors: [],
    jdSeniority: "unknown",
  });
  const warnings: string[] = [];
  if (inv.droppedMetrics.length > 0) {
    warnings.push(`${id}: dropped metric ${inv.droppedMetrics.join(", ")}`);
  }
  const beforeMetrics = new Set(extractMetrics(before));
  const added = [
    ...new Set(
      extractMetrics(after).filter(
        (m) => !beforeMetrics.has(m) && !groundMetrics.has(m),
      ),
    ),
  ];
  if (added.length > 0) {
    warnings.push(`${id}: possible invented metric ${added.join(", ")}`);
  }
  if (inv.seniorityInflated) warnings.push(`${id}: seniority wording inflated`);
  return warnings;
}

export function keywordWarnings(
  injected: { keyword: string; where: string }[],
  groundText: string,
): string[] {
  const ground = groundText.toLowerCase();
  return injected
    .filter((k) => !ground.includes(k.keyword.toLowerCase()))
    .map(
      (k) =>
        `"${k.keyword}" (${k.where}) isn't in your corpus or master resume — reframed; make sure you can speak to it`,
    );
}
```

- [ ] **Step 4: Run tests** — `pnpm test:skill -- tailor-checks`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/skill/src/tailor/checks.ts tests/skill/tailor-checks.test.ts
git commit -m "feat: warn-only tailoring checks plus hard LaTeX safety check"
```

---

### Task 4: headless Claude runner

**Files:**
- Create: `packages/skill/src/tailor/claude-cli.ts`
- Create: `tests/skill/fixtures/fake-claude.mjs`
- Test: `tests/skill/claude-cli.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface ClaudeRunOptions { system: string; prompt: string; schema: object; model?: string; cwd?: string; timeoutMs?: number; bin?: string }
  type ClaudeRunner = (opts: ClaudeRunOptions) => Promise<unknown>
  runClaude: ClaudeRunner
  parseClaudeOutput(stdout: string): unknown
  ```

- [ ] **Step 1: Create the fake CLI** — `tests/skill/fixtures/fake-claude.mjs`:

```js
#!/usr/bin/env node
// Test double for the claude CLI: echoes args/stdin/env back as structured output.
let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const mode = process.env.FAKE_CLAUDE_MODE ?? "ok";
  if (mode === "hang") {
    setTimeout(() => {}, 60_000);
    return;
  }
  if (mode === "error") {
    process.stdout.write(JSON.stringify({ is_error: true, result: "boom" }));
    return;
  }
  if (mode === "garbage") {
    process.stdout.write("not json");
    process.exit(1);
  }
  process.stdout.write(
    JSON.stringify({
      is_error: false,
      structured_output: {
        args: process.argv.slice(2),
        input,
        noClaudeMd: process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS,
      },
    }),
  );
});
```

- [ ] **Step 2: Write failing tests** — `tests/skill/claude-cli.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { chmodSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runClaude, parseClaudeOutput } from "../../packages/skill/src/tailor/claude-cli";

const FAKE = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));

beforeAll(() => chmodSync(FAKE, 0o755));
afterEach(() => {
  delete process.env.FAKE_CLAUDE_MODE;
});

describe("runClaude", () => {
  it("sends the prompt on stdin, isolates context, and returns structured output", async () => {
    const out = (await runClaude({
      bin: FAKE,
      system: "SYS",
      prompt: "hello",
      schema: { type: "object" },
    })) as { args: string[]; input: string; noClaudeMd: string };
    expect(out.input).toBe("hello");
    const arg = (flag: string) => out.args[out.args.indexOf(flag) + 1];
    expect(arg("--system-prompt")).toBe("SYS");
    expect(arg("--tools")).toBe("");
    expect(arg("--json-schema")).toBe('{"type":"object"}');
    expect(arg("--setting-sources")).toBe("project");
    expect(out.args).toContain("--no-session-persistence");
    expect(out.args).not.toContain("--bare");
    expect(out.noClaudeMd).toBe("1");
  });

  it("rejects when claude reports an error", async () => {
    process.env.FAKE_CLAUDE_MODE = "error";
    await expect(
      runClaude({ bin: FAKE, system: "s", prompt: "p", schema: {} }),
    ).rejects.toThrow(/boom/);
  });

  it("rejects on timeout", async () => {
    process.env.FAKE_CLAUDE_MODE = "hang";
    await expect(
      runClaude({ bin: FAKE, system: "s", prompt: "p", schema: {}, timeoutMs: 300 }),
    ).rejects.toThrow(/timed out/);
  });

  it("rejects clearly when the binary is missing", async () => {
    await expect(
      runClaude({ bin: "/nonexistent/claude", system: "s", prompt: "p", schema: {} }),
    ).rejects.toThrow(/not found/);
  });
});

describe("parseClaudeOutput", () => {
  it("falls back to a fenced JSON result string", () => {
    expect(parseClaudeOutput(JSON.stringify({ result: '```json\n{"a":1}\n```' }))).toEqual({ a: 1 });
  });
  it("rejects non-JSON stdout", () => {
    expect(() => parseClaudeOutput("nope")).toThrow(/non-JSON/);
  });
});
```

- [ ] **Step 3: Run to verify failure** — `pnpm test:skill -- claude-cli`. Expected: FAIL (module missing).

- [ ] **Step 4: Implement** — `packages/skill/src/tailor/claude-cli.ts`:

```ts
import { spawn } from "node:child_process";

export interface ClaudeRunOptions {
  system: string;
  prompt: string;
  schema: object;
  model?: string;
  cwd?: string;
  timeoutMs?: number;
  bin?: string;
}

export type ClaudeRunner = (opts: ClaudeRunOptions) => Promise<unknown>;

// Headless Claude Code on the user's subscription — never the paid API.
// --bare is deliberately absent: it forces ANTHROPIC_API_KEY auth. Context is
// isolated instead: no tools, no user settings/hooks/MCP, no CLAUDE.md, so the
// user's global instructions (e.g. terse "caveman" style) can't leak into a
// cover letter.
export const runClaude: ClaudeRunner = (opts) =>
  new Promise((resolve, reject) => {
    const timeoutMs = opts.timeoutMs ?? 180_000;
    const args = [
      "-p",
      "--output-format", "json",
      "--model", opts.model ?? process.env.APPLYMATE_MODEL ?? "sonnet",
      "--tools", "",
      "--no-session-persistence",
      "--setting-sources", "project",
      "--strict-mcp-config",
      "--system-prompt", opts.system,
      "--json-schema", JSON.stringify(opts.schema),
    ];
    const child = spawn(opts.bin ?? process.env.APPLYMATE_CLAUDE_BIN ?? "claude", args, {
      cwd: opts.cwd,
      env: {
        ...process.env,
        CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1",
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new Error(`claude timed out after ${Math.round(timeoutMs / 1000)}s`)));
    }, timeoutMs);

    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.stdin.on("error", () => {}); // EPIPE when the binary is missing/dies early
    child.on("error", (err: NodeJS.ErrnoException) =>
      finish(() =>
        reject(
          err.code === "ENOENT"
            ? new Error("claude CLI not found on PATH — install Claude Code and log in")
            : err,
        ),
      ),
    );
    child.on("close", (code) =>
      finish(() => {
        try {
          resolve(parseClaudeOutput(stdout));
        } catch (err) {
          const detail = stderr.trim() ? `: ${stderr.trim().slice(-400)}` : "";
          reject(new Error(`${(err as Error).message}${code ? ` (exit ${code})` : ""}${detail}`));
        }
      }),
    );
    child.stdin.end(opts.prompt);
  });

export function parseClaudeOutput(stdout: string): unknown {
  let d: { is_error?: boolean; result?: unknown; structured_output?: unknown; subtype?: string };
  try {
    d = JSON.parse(stdout);
  } catch {
    throw new Error("claude returned non-JSON output");
  }
  if (d.is_error) throw new Error(`claude error: ${String(d.result ?? d.subtype ?? "unknown")}`);
  if (d.structured_output !== undefined) return d.structured_output;
  if (typeof d.result === "string") {
    const body = d.result.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try {
      return JSON.parse(body);
    } catch {
      throw new Error("claude result was not valid JSON");
    }
  }
  throw new Error("claude output had no structured result");
}
```

- [ ] **Step 5: Run tests** — `pnpm test:skill -- claude-cli`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/skill/src/tailor/claude-cli.ts tests/skill/fixtures/fake-claude.mjs tests/skill/claude-cli.test.ts
git commit -m "feat: isolated headless claude -p runner with structured output"
```

---

### Task 5: shared tailor types, prompt, cover letter, orchestrator

**Files:**
- Modify: `lib/shared/types.ts`
- Create: `packages/skill/src/tailor/prompt.ts`, `packages/skill/src/tailor/letter.ts`, `packages/skill/src/tailor/run.ts`
- Test: `tests/skill/tailor-prompt.test.ts`, `tests/skill/tailor-run.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces (in `lib/shared/types.ts`):
  ```ts
  interface TailorQuestion { fieldId: string; label: string; type: string; options?: string[]; required: boolean }
  interface TailorRequest { job: { title: string; company: string; url: string; description: string }; keywords: string[]; fields: TailorQuestion[]; wantCoverLetterPdf: boolean }
  interface KeywordReport { injected: { keyword: string; where: string }[]; skipped: { keyword: string; reason: string }[] }
  interface EditRecord { id: string; before: string; after: string; reverted?: string }
  interface TailorResult { applicationId: string; fileName: string; coverLetter: string; hasCoverLetterPdf: boolean; answers: { fieldId: string; value: string }[]; keywords: KeywordReport; edits: EditRecord[]; warnings: string[]; pages: number; savedTo: string }
  interface RunReport { url: string; title: string; company: string; jdSource: string; filled: number; needsYou: string[]; result?: TailorResult; error?: string; at: number }
  ```
- Produces (skill): `TAILOR_SYSTEM: string`, `TAILOR_SCHEMA: object`, `buildTailorPrompt(req: TailorRequest, ctx: { doc: ResumeDoc; corpusYaml: string; directives: string; profileYaml: string }): string`, `parseTailorOutput(raw: unknown): ClaudeTailorOutput`, `coverLetterTex(name: string, body: string): string`, `profileName(profileYaml: string): { first: string; last: string }`, `tailorResume(req: TailorRequest, files: TailorFiles, deps: TailorDeps): Promise<TailorOutcome>` where
  ```ts
  interface TailorFiles { masterTex: string; corpusYaml: string; directives: string; profileYaml: string }
  interface TailorDeps { runClaude: ClaudeRunner; compile: (latex: string) => Promise<{ pdf: Buffer; pages: number }>; claudeCwd?: string }
  interface TailorOutcome { tex: string; pdf: Buffer; pages: number; coverLetter: string; coverLetterPdf?: Buffer; answers: { fieldId: string; value: string }[]; keywords: KeywordReport; edits: EditRecord[]; warnings: string[] }
  ```

- [ ] **Step 1: Add shared types** — append to `lib/shared/types.ts`:

```ts
// ---- One-click tailoring (extension ⇄ bridge) ----

export interface TailorQuestion {
  fieldId: string;
  label: string;
  type: string;
  options?: string[];
  required: boolean;
}

export interface TailorRequest {
  job: { title: string; company: string; url: string; description: string };
  keywords: string[];
  fields: TailorQuestion[];
  wantCoverLetterPdf: boolean;
}

export interface KeywordReport {
  injected: { keyword: string; where: string }[];
  skipped: { keyword: string; reason: string }[];
}

export interface EditRecord {
  id: string;
  before: string;
  after: string;
  reverted?: string;
}

export interface TailorResult {
  applicationId: string;
  fileName: string;
  coverLetter: string;
  hasCoverLetterPdf: boolean;
  answers: { fieldId: string; value: string }[];
  keywords: KeywordReport;
  edits: EditRecord[];
  warnings: string[];
  pages: number;
  savedTo: string;
}

export interface RunReport {
  url: string;
  title: string;
  company: string;
  jdSource: string;
  filled: number;
  needsYou: string[];
  result?: TailorResult;
  error?: string;
  at: number;
}
```

- [ ] **Step 2: Write failing prompt tests** — `tests/skill/tailor-prompt.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseResume } from "../../packages/skill/src/tailor/resume-doc";
import {
  buildTailorPrompt,
  parseTailorOutput,
  TAILOR_SCHEMA,
  TAILOR_SYSTEM,
} from "../../packages/skill/src/tailor/prompt";
import type { TailorRequest } from "../../lib/shared/types";

const tex = readFileSync(
  fileURLToPath(new URL("./fixtures/resume-master.tex", import.meta.url)),
  "utf8",
);
const ctx = { doc: parseResume(tex), corpusYaml: "experiences: []", directives: "Lead with X", profileYaml: "name: {first: Jane}" };
const req: TailorRequest = {
  job: { title: "Platform Engineer", company: "Acme", url: "https://x/1", description: "We use Kubernetes and Terraform." },
  keywords: ["terraform", "go"],
  fields: [
    { fieldId: "auth", label: "Authorized to work?", type: "select", options: ["Yes", "No"], required: true },
    { fieldId: "why", label: "Why Acme?", type: "textarea", required: false },
  ],
  wantCoverLetterPdf: false,
};

describe("buildTailorPrompt", () => {
  const p = buildTailorPrompt(req, ctx);
  it("lists every editable id under its role heading", () => {
    for (const id of ["summary", "r0.b0", "r0.b1", "r1.b0", "r2.b0", "skills.languages"]) {
      expect(p).toContain(`[${id}]`);
    }
    expect(p).toContain("## r0 — Acme Corp");
  });
  it("includes JD, priority keywords, questions with options, corpus, directives, profile", () => {
    expect(p).toContain("We use Kubernetes and Terraform.");
    expect(p).toContain("terraform, go");
    expect(p).toContain("[auth] Authorized to work? (select; required; options: Yes | No)");
    expect(p).toContain("[why] Why Acme? (textarea; optional)");
    expect(p).toContain("experiences: []");
    expect(p).toContain("Lead with X");
    expect(p).toContain("name: {first: Jane}");
  });
  it("says so when the JD is unavailable", () => {
    const q = buildTailorPrompt({ ...req, job: { ...req.job, description: "" } }, ctx);
    expect(q).toMatch(/not available/i);
  });
});

describe("schema + system", () => {
  it("requires every output key", () => {
    expect((TAILOR_SCHEMA as { required: string[] }).required).toEqual([
      "edits", "order", "keywords", "coverLetter", "answers",
    ]);
  });
  it("forbids inventing metrics and demands exact options", () => {
    expect(TAILOR_SYSTEM).toMatch(/Never invent metrics/);
    expect(TAILOR_SYSTEM).toMatch(/exactly one of the listed options/);
  });
});

describe("parseTailorOutput", () => {
  it("normalizes missing and malformed parts", () => {
    const out = parseTailorOutput({
      edits: [{ id: "r0.b0", latex: "x" }, { id: 3 }],
      keywords: { injected: [{ keyword: "go", where: "r2.b0" }] },
    });
    expect(out.edits).toEqual([{ id: "r0.b0", latex: "x" }]);
    expect(out.order).toEqual([]);
    expect(out.keywords.skipped).toEqual([]);
    expect(out.coverLetter).toBe("");
    expect(out.answers).toEqual([]);
  });
});
```

- [ ] **Step 3: Implement prompt** — `packages/skill/src/tailor/prompt.ts`:

```ts
import type { ResumeDoc } from "./resume-doc";
import type { KeywordReport, TailorRequest } from "../../../../lib/shared/types";

export interface ClaudeTailorOutput {
  edits: { id: string; latex: string }[];
  order: { role: string; ids: string[] }[];
  keywords: KeywordReport;
  coverLetter: string;
  answers: { fieldId: string; value: string }[];
}

export interface PromptContext {
  doc: ResumeDoc;
  corpusYaml: string;
  directives: string;
  profileYaml: string;
}

export const TAILOR_SYSTEM = `You tailor one software engineer's LaTeX resume to one job and draft their application answers. Respond only through the structured output schema.

RESUME EDITS
- Edit only the ids listed under "Resume parts". Return an edit only for parts you change.
- Work in keywords from the job description and the candidate's priority keywords wherever they honestly apply to the work already described. You may reframe adjacent real work in the job's vocabulary (e.g. "Kustomize overlays" -> "infrastructure as code"), but every claim must be supported by that bullet or by the experience corpus.
- Never invent metrics, employers, titles, dates, degrees, certifications or projects. Keep every number from the original bullet; you may add a number only if it appears in the experience corpus for that same work.
- Keep each bullet within about 10% of its original length. The resume must stay on one page.
- LaTeX: keep the existing \\textbf{} emphasis style; escape % & $ # _ as \\% \\& \\$ \\# \\_; keep braces balanced; no new macros or environments.
- Skills lines: reorder to front-load what the job emphasizes. Do not remove items; add an item only if the corpus evidences it.
- order: for any role (r0, r1, ...) you may give a permutation of all of its bullet ids, most job-relevant first. Omit roles you leave as-is.
- keywords.injected: each keyword you worked in and the id where it now appears. keywords.skipped: important job or priority keywords you did not use, each with a short honest reason (e.g. "no experience in corpus").

COVER LETTER
- Plain text, no LaTeX or markdown. Start with "Dear Hiring Team," then three short paragraphs specific to this company and role, grounded in the corpus, no cliches, no placeholders. End with "Sincerely," and the candidate's full name from the profile on the next line.
- If the job description is unavailable, write from the title, company and keywords.

FORM ANSWERS
- Answer every listed question by fieldId.
- If a question lists options, value must be exactly one of the listed options, copied verbatim.
- Use the candidate profile for factual answers (work authorization, sponsorship, location, links, demographics). If the profile lacks the fact, choose the most neutral option (e.g. "Decline to self-identify") or return "".
- Free-text answers: 2-4 specific sentences grounded in the corpus, first person, no cliches.`;

const str = { type: "string" } as const;
const obj = (props: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(props),
  properties: props,
});

export const TAILOR_SCHEMA = obj({
  edits: { type: "array", items: obj({ id: str, latex: str }) },
  order: { type: "array", items: obj({ role: str, ids: { type: "array", items: str } }) },
  keywords: obj({
    injected: { type: "array", items: obj({ keyword: str, where: str }) },
    skipped: { type: "array", items: obj({ keyword: str, reason: str }) },
  }),
  coverLetter: str,
  answers: { type: "array", items: obj({ fieldId: str, value: str }) },
});

export function buildTailorPrompt(req: TailorRequest, ctx: PromptContext): string {
  const byId = new Map(ctx.doc.parts.map((p) => [p.id, p]));
  const summary = byId.get("summary");
  const skills = ctx.doc.parts.filter((p) => p.kind === "skills");
  const questions = req.fields.map((f) => {
    const meta = [f.type, f.required ? "required" : "optional"];
    if (f.options?.length) meta.push(`options: ${f.options.join(" | ")}`);
    return `[${f.fieldId}] ${f.label} (${meta.join("; ")})`;
  });

  return [
    "# Job",
    `Title: ${req.job.title || "(unknown)"}`,
    `Company: ${req.job.company || "(unknown)"}`,
    `URL: ${req.job.url}`,
    "",
    "## Job description",
    req.job.description.trim()
      ? req.job.description.trim()
      : "(not available — tailor to the title, company and priority keywords)",
    "",
    "# Candidate's priority keywords",
    req.keywords.length ? req.keywords.join(", ") : "(none)",
    "",
    "# Resume parts (LaTeX). Only these ids exist.",
    ...(summary ? ["## summary", `[summary] ${summary.text}`, ""] : []),
    ...ctx.doc.groups.flatMap((g) => [
      `## ${g.id} — ${g.heading}`,
      ...g.bulletIds.map((id) => `[${id}] ${byId.get(id)!.text}`),
      "",
    ]),
    ...(skills.length ? ["## skills", ...skills.map((p) => `[${p.id}] ${p.text}`), ""] : []),
    "# Experience corpus (ground truth about the candidate)",
    ctx.corpusYaml.trim() || "(none)",
    "",
    "# Audience directives",
    ctx.directives.trim() || "(none)",
    "",
    "# Application form questions",
    questions.length ? questions.join("\n") : "(none)",
    "",
    "# Candidate profile",
    ctx.profileYaml.trim() || "(none)",
  ].join("\n");
}

const isStr = (v: unknown): v is string => typeof v === "string";
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : [];

// Schema validation happens in the CLI; this is defense in depth so a
// malformed field degrades to "no change" instead of a crash.
export function parseTailorOutput(raw: unknown): ClaudeTailorOutput {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kw = (r.keywords && typeof r.keywords === "object" ? r.keywords : {}) as Record<string, unknown>;
  return {
    edits: arr(r.edits)
      .filter((e) => isStr(e.id) && isStr(e.latex))
      .map((e) => ({ id: e.id as string, latex: e.latex as string })),
    order: arr(r.order)
      .filter((o) => isStr(o.role) && Array.isArray(o.ids) && o.ids.every(isStr))
      .map((o) => ({ role: o.role as string, ids: o.ids as string[] })),
    keywords: {
      injected: arr(kw.injected)
        .filter((k) => isStr(k.keyword))
        .map((k) => ({ keyword: k.keyword as string, where: isStr(k.where) ? k.where : "" })),
      skipped: arr(kw.skipped)
        .filter((k) => isStr(k.keyword))
        .map((k) => ({ keyword: k.keyword as string, reason: isStr(k.reason) ? k.reason : "" })),
    },
    coverLetter: isStr(r.coverLetter) ? r.coverLetter : "",
    answers: arr(r.answers)
      .filter((a) => isStr(a.fieldId) && isStr(a.value))
      .map((a) => ({ fieldId: a.fieldId as string, value: a.value as string })),
  };
}
```

- [ ] **Step 4: Run prompt tests** — `pnpm test:skill -- tailor-prompt`. Expected: PASS.

- [ ] **Step 5: Implement letter** — `packages/skill/src/tailor/letter.ts`:

```ts
import { parse } from "yaml";
import { escapeLatex } from "../stages/assemble-latex";

export function profileName(profileYaml: string): { first: string; last: string } {
  try {
    const p = parse(profileYaml) as { name?: { first?: unknown; last?: unknown } } | null;
    return {
      first: typeof p?.name?.first === "string" ? p.name.first : "",
      last: typeof p?.name?.last === "string" ? p.name.last : "",
    };
  } catch {
    return { first: "", last: "" };
  }
}

export function coverLetterTex(name: string, body: string): string {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.split("\n").map(escapeLatex).join("\\\\\n"));
  return [
    "\\documentclass[11pt,letterpaper]{article}",
    "\\usepackage[margin=1in]{geometry}",
    "\\usepackage[default]{lato}",
    "\\setlength{\\parindent}{0pt}",
    "\\setlength{\\parskip}{10pt}",
    "\\pagestyle{empty}",
    "\\begin{document}",
    name ? `{\\Large\\bfseries ${escapeLatex(name)}}\\par` : "",
    ...paragraphs.map((p) => `${p}\n`),
    "\\end{document}",
    "",
  ].join("\n");
}
```

- [ ] **Step 6: Write failing orchestrator tests** — `tests/skill/tailor-run.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tailorResume } from "../../packages/skill/src/tailor/run";
import { coverLetterTex } from "../../packages/skill/src/tailor/letter";
import type { TailorRequest } from "../../lib/shared/types";

const masterTex = readFileSync(
  fileURLToPath(new URL("./fixtures/resume-master.tex", import.meta.url)),
  "utf8",
);
const files = {
  masterTex,
  corpusYaml: "experiences:\n  - skills: [kubernetes, rust]\n    metrics: ['500 developers']\n",
  directives: "",
  profileYaml: "name: {first: Jane, last: Dev}\n",
};
const req: TailorRequest = {
  job: { title: "SRE", company: "Acme", url: "https://x/1", description: "Kubernetes" },
  keywords: [],
  fields: [],
  wantCoverLetterPdf: false,
};
const onePage = async (latex: string) => ({ pdf: Buffer.from(latex), pages: 1 });
const runner = (out: unknown) => async () => out;

describe("tailorResume", () => {
  it("applies valid edits and order, reporting before/after", async () => {
    const out = await tailorResume(req, files, {
      compile: onePage,
      runClaude: runner({
        edits: [{ id: "r1.b0", latex: "Migrated \\textbf{15+ services} to \\textbf{Kubernetes} with HPA." }],
        order: [{ role: "r0", ids: ["r0.b1", "r0.b0"] }],
        keywords: { injected: [{ keyword: "Kubernetes", where: "r1.b0" }], skipped: [] },
        coverLetter: "Dear Hiring Team,\n\nHi.",
        answers: [{ fieldId: "why", value: "Because." }],
      }),
    });
    expect(out.tex).toContain("to \\textbf{Kubernetes} with HPA.");
    expect(out.tex.indexOf("Cut CI time")).toBeLessThan(out.tex.indexOf("Built a \\textbf{Rust}"));
    expect(out.edits).toEqual([
      expect.objectContaining({ id: "r1.b0", after: expect.stringContaining("HPA"), reverted: undefined }),
    ]);
    expect(out.answers).toEqual([{ fieldId: "why", value: "Because." }]);
    expect(out.warnings).toEqual([]);
    expect(out.coverLetterPdf).toBeUndefined();
  });

  it("reverts LaTeX-breaking edits and ignores unknown ids, with warnings", async () => {
    const out = await tailorResume(req, files, {
      compile: onePage,
      runClaude: runner({
        edits: [
          { id: "r0.b0", latex: "Cut 40% of costs" },
          { id: "r9.b9", latex: "ghost" },
        ],
      }),
    });
    expect(out.tex).toBe(masterTex);
    expect(out.edits[0].reverted).toMatch(/unescaped %/);
    expect(out.warnings.join("\n")).toMatch(/unknown id r9\.b9/);
  });

  it("warns (but keeps) invented metrics and reframed keywords", async () => {
    const out = await tailorResume(req, files, {
      compile: onePage,
      runClaude: runner({
        edits: [{ id: "r1.b0", latex: "Migrated \\textbf{15+ services} to \\textbf{Kubernetes}, saving 30 hours." }],
        keywords: { injected: [{ keyword: "Terraform", where: "r1.b0" }], skipped: [] },
      }),
    });
    expect(out.tex).toContain("saving 30 hours");
    expect(out.warnings.join("\n")).toMatch(/invented metric 30/);
    expect(out.warnings.join("\n")).toMatch(/Terraform/);
  });

  it("reverts the largest-growth edit until the resume fits one page", async () => {
    const limit = masterTex.length + 40;
    const out = await tailorResume(req, files, {
      compile: async (latex) => ({ pdf: Buffer.from("x"), pages: latex.length > limit ? 2 : 1 }),
      runClaude: runner({
        edits: [
          { id: "r0.b0", latex: "Built a \\textbf{Rust} HTTP service handling \\textbf{10k req/s} at \\textbf{100ms} p99 for payments." },
          { id: "r1.b0", latex: `Migrated \\textbf{15+ services} to \\textbf{Kubernetes}${" and more".repeat(20)}.` },
        ],
      }),
    });
    expect(out.pages).toBe(1);
    expect(out.edits.find((e) => e.id === "r1.b0")!.reverted).toMatch(/one page/);
    expect(out.edits.find((e) => e.id === "r0.b0")!.reverted).toBeUndefined();
  });

  it("falls back to the master resume when the edited resume fails to compile", async () => {
    const out = await tailorResume(req, files, {
      compile: async (latex) => {
        if (latex !== masterTex) throw new Error("tectonic failed: boom");
        return { pdf: Buffer.from("master"), pages: 1 };
      },
      runClaude: runner({ edits: [{ id: "r0.b0", latex: "Fine text" }] }),
    });
    expect(out.tex).toBe(masterTex);
    expect(out.pdf.toString()).toBe("master");
    expect(out.warnings.join("\n")).toMatch(/fell back to your master resume/);
  });

  it("compiles a cover letter PDF only when asked", async () => {
    const compiled: string[] = [];
    const out = await tailorResume({ ...req, wantCoverLetterPdf: true }, files, {
      compile: async (latex) => {
        compiled.push(latex);
        return { pdf: Buffer.from("pdf"), pages: 1 };
      },
      runClaude: runner({ coverLetter: "Dear Hiring Team,\n\nI like 100% of it." }),
    });
    expect(out.coverLetterPdf).toBeDefined();
    expect(compiled[1]).toContain("Jane Dev");
    expect(compiled[1]).toContain("100\\% of it");
  });
});

describe("coverLetterTex", () => {
  it("escapes specials and keeps line breaks", () => {
    const t = coverLetterTex("A & B", "Sincerely,\nA & B");
    expect(t).toContain("A \\& B");
    expect(t).toContain("Sincerely,\\\\\nA \\& B");
  });
});
```

- [ ] **Step 7: Implement orchestrator** — `packages/skill/src/tailor/run.ts`:

```ts
import { parseResume, renderResume } from "./resume-doc";
import { latexProblem, editWarnings, keywordWarnings } from "./checks";
import { buildTailorPrompt, parseTailorOutput, TAILOR_SCHEMA, TAILOR_SYSTEM } from "./prompt";
import { coverLetterTex, profileName } from "./letter";
import type { ClaudeRunner } from "./claude-cli";
import { extractMetrics } from "../validators/invariant-checks";
import type { EditRecord, KeywordReport, TailorRequest } from "../../../../lib/shared/types";

export interface TailorFiles {
  masterTex: string;
  corpusYaml: string;
  directives: string;
  profileYaml: string;
}

export interface TailorDeps {
  runClaude: ClaudeRunner;
  compile: (latex: string) => Promise<{ pdf: Buffer; pages: number }>;
  claudeCwd?: string;
}

export interface TailorOutcome {
  tex: string;
  pdf: Buffer;
  pages: number;
  coverLetter: string;
  coverLetterPdf?: Buffer;
  answers: { fieldId: string; value: string }[];
  keywords: KeywordReport;
  edits: EditRecord[];
  warnings: string[];
}

const MAX_FIT_ROUNDS = 10;

export async function tailorResume(
  req: TailorRequest,
  files: TailorFiles,
  deps: TailorDeps,
): Promise<TailorOutcome> {
  const doc = parseResume(files.masterTex);
  const raw = await deps.runClaude({
    system: TAILOR_SYSTEM,
    prompt: buildTailorPrompt(req, {
      doc,
      corpusYaml: files.corpusYaml,
      directives: files.directives,
      profileYaml: files.profileYaml,
    }),
    schema: TAILOR_SCHEMA,
    cwd: deps.claudeCwd,
  });
  const out = parseTailorOutput(raw);

  const warnings: string[] = [];
  // Ground truth = corpus + the resume's own editable text. Not the whole
  // .tex: preamble layout numbers (10.75pt, 0.97\textwidth) would mask
  // invented metrics.
  const groundText = `${files.corpusYaml}\n${doc.parts.map((p) => p.text).join("\n")}`;
  const groundMetrics = new Set(extractMetrics(groundText));
  const partsById = new Map(doc.parts.map((p) => [p.id, p]));

  const edits: EditRecord[] = [];
  for (const e of out.edits) {
    const part = partsById.get(e.id);
    if (!part) {
      warnings.push(`Ignored an edit for unknown id ${e.id}`);
      continue;
    }
    if (e.latex.trim() === part.text.trim()) continue;
    const problem = latexProblem(e.latex);
    edits.push({ id: e.id, before: part.text, after: e.latex, reverted: problem ?? undefined });
    if (problem) warnings.push(`${e.id}: reverted (${problem})`);
    else warnings.push(...editWarnings(e.id, part.text, e.latex, groundMetrics));
  }

  const order: Record<string, string[]> = {};
  for (const o of out.order) {
    const group = doc.groups.find((g) => g.id === o.role);
    if (!group) warnings.push(`Ignored a reorder for unknown role ${o.role}`);
    else order[o.role] = o.ids; // renderResume ignores non-permutations
  }

  warnings.push(...keywordWarnings(out.keywords.injected, groundText));

  const active = () =>
    Object.fromEntries(edits.filter((e) => !e.reverted).map((e) => [e.id, e.after]));

  let tex = renderResume(doc, active(), order);
  let compiled: { pdf: Buffer; pages: number };
  try {
    compiled = await deps.compile(tex);
    for (let round = 0; compiled.pages > 1 && round < MAX_FIT_ROUNDS; round++) {
      const victim = edits
        .filter((e) => !e.reverted)
        .sort((a, b) => b.after.length - b.before.length - (a.after.length - a.before.length))[0];
      if (!victim) break;
      victim.reverted = "reverted to keep the resume on one page";
      tex = renderResume(doc, active(), order);
      compiled = await deps.compile(tex);
    }
    if (compiled.pages > 1) warnings.push(`Resume is ${compiled.pages} pages even with all edits reverted`);
  } catch (err) {
    for (const e of edits) e.reverted ??= "compile error";
    warnings.push(
      `Tailored resume failed to compile, so ApplyMate fell back to your master resume: ${String((err as Error).message).slice(0, 200)}`,
    );
    tex = files.masterTex;
    compiled = await deps.compile(tex);
  }

  let coverLetterPdf: Buffer | undefined;
  if (req.wantCoverLetterPdf && out.coverLetter.trim()) {
    const { first, last } = profileName(files.profileYaml);
    coverLetterPdf = (await deps.compile(coverLetterTex(`${first} ${last}`.trim(), out.coverLetter))).pdf;
  }

  return {
    tex,
    pdf: compiled.pdf,
    pages: compiled.pages,
    coverLetter: out.coverLetter,
    coverLetterPdf,
    answers: out.answers,
    keywords: out.keywords,
    edits,
    warnings,
  };
}
```

- [ ] **Step 8: Run tests** — `pnpm test:skill -- tailor-run tailor-prompt` then `pnpm type-check:skill`. Expected: PASS, no type errors.

- [ ] **Step 9: Commit**

```bash
git add lib/shared/types.ts packages/skill/src/tailor tests/skill/tailor-prompt.test.ts tests/skill/tailor-run.test.ts
git commit -m "feat: claude-driven full-resume tailoring with page fit and fallbacks"
```

---

### Task 6: bridge persistence helpers + job queue

**Files:**
- Modify: `packages/bridge/src/persist.ts`
- Create: `packages/bridge/src/jobs.ts`
- Test: `tests/bridge/persist.test.ts` (append), `tests/bridge/jobs.test.ts`

**Interfaces:**
- Produces: `deterministicAppId(jobUrl: string): string` (now exported), `applicationDirName(date: Date, company: string, title: string): string`, `saveApplicationFiles(dir: string, f: { resumeTex: string; resumePdf: Buffer; coverLetter: string; report: unknown; jd: string }): Promise<void>`, `markApplied(db: Db, a: { jobUrl: string; company: string; jobTitle: string }): string`; `class JobQueue<I, R> { constructor(work: (input: I) => Promise<R>); enqueue(input: I): string; get(id: string): Job<R> | undefined; idle(): Promise<void> }` with `Job<R> = { id; status: "queued" | "running" | "done" | "error"; result?: R; error?: string }`.

- [ ] **Step 1: Write failing tests** — append to `tests/bridge/persist.test.ts`:

```ts
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import {
  applicationDirName,
  saveApplicationFiles,
  markApplied,
  deterministicAppId,
} from "../../packages/bridge/src/persist";

describe("application files + status", () => {
  it("names app dirs by date, company and role", () => {
    expect(applicationDirName(new Date("2026-09-28T12:00:00Z"), "Acme, Inc.", "Senior SWE (Platform)")).toBe(
      "2026-09-28-acme-inc-senior-swe-platform",
    );
    expect(applicationDirName(new Date("2026-09-28T12:00:00Z"), "", "")).toBe("2026-09-28-company-role");
  });

  it("saves resume, cover letter, report and JD", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "am-app-")), "x");
    await saveApplicationFiles(dir, {
      resumeTex: "\\tex",
      resumePdf: Buffer.from("%PDF"),
      coverLetter: "Dear",
      report: { a: 1 },
      jd: "JD",
    });
    expect(readFileSync(join(dir, "resume.tex"), "utf8")).toBe("\\tex");
    expect(existsSync(join(dir, "resume.pdf"))).toBe(true);
    expect(readFileSync(join(dir, "cover-letter.md"), "utf8")).toBe("Dear");
    expect(JSON.parse(readFileSync(join(dir, "report.json"), "utf8"))).toEqual({ a: 1 });
    expect(readFileSync(join(dir, "jd.md"), "utf8")).toBe("JD");
  });

  it("marks an application applied, creating it if needed", () => {
    const id = markApplied(db, { jobUrl: "https://x.com/j2", company: "Acme", jobTitle: "SRE" });
    expect(id).toBe(deterministicAppId("https://x.com/j2"));
    const row = listApplications(db).find((a) => a.id === id)!;
    expect(row.status).toBe("applied");
    expect(row.company).toBe("Acme");
  });
});
```

`tests/bridge/jobs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { JobQueue } from "../../packages/bridge/src/jobs";

describe("JobQueue", () => {
  it("runs jobs one at a time in FIFO order", async () => {
    const log: string[] = [];
    const q = new JobQueue<string, string>(async (x) => {
      log.push(`start ${x}`);
      await new Promise((r) => setTimeout(r, 10));
      log.push(`end ${x}`);
      return x.toUpperCase();
    });
    const a = q.enqueue("a");
    const b = q.enqueue("b");
    expect(q.get(b)!.status).toBe("queued");
    await q.idle();
    expect(log).toEqual(["start a", "end a", "start b", "end b"]);
    expect(q.get(a)).toMatchObject({ status: "done", result: "A" });
  });

  it("records errors without stopping the queue", async () => {
    const q = new JobQueue<number, number>(async (n) => {
      if (n === 1) throw new Error("bad");
      return n;
    });
    const bad = q.enqueue(1);
    const good = q.enqueue(2);
    await q.idle();
    expect(q.get(bad)).toMatchObject({ status: "error", error: "bad" });
    expect(q.get(good)).toMatchObject({ status: "done", result: 2 });
  });

  it("returns undefined for unknown ids", () => {
    expect(new JobQueue(async () => 1).get("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm test:bridge`. Expected: FAIL (missing exports/module).

- [ ] **Step 3: Implement** — in `packages/bridge/src/persist.ts` change `function deterministicAppId` to `export function deterministicAppId`, add imports `import { mkdir, writeFile } from "node:fs/promises"; import { join } from "node:path";`, and append:

```ts
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export function applicationDirName(date: Date, company: string, title: string): string {
  return [date.toISOString().slice(0, 10), slug(company) || "company", slug(title) || "role"].join("-");
}

export async function saveApplicationFiles(
  dir: string,
  f: { resumeTex: string; resumePdf: Buffer; coverLetter: string; report: unknown; jd: string },
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(join(dir, "resume.tex"), f.resumeTex, "utf8"),
    writeFile(join(dir, "resume.pdf"), f.resumePdf),
    writeFile(join(dir, "cover-letter.md"), f.coverLetter, "utf8"),
    writeFile(join(dir, "report.json"), JSON.stringify(f.report, null, 2), "utf8"),
    writeFile(join(dir, "jd.md"), f.jd, "utf8"),
  ]);
}

// Same id the tailor run used for this URL, so status lands on that row.
export function markApplied(
  db: Db,
  a: { jobUrl: string; company: string; jobTitle: string },
): string {
  const id = deterministicAppId(a.jobUrl);
  insertApplication(db, {
    id,
    company: a.company || "Unknown",
    jobTitle: a.jobTitle || "Unknown",
    jobUrl: a.jobUrl,
    status: "applied",
  });
  return id;
}
```

`packages/bridge/src/jobs.ts`:

```ts
import { randomUUID } from "node:crypto";

export type JobStatus = "queued" | "running" | "done" | "error";

export interface Job<R> {
  id: string;
  status: JobStatus;
  result?: R;
  error?: string;
}

const MAX_JOBS = 50;

// ponytail: one global FIFO — Claude runs are serialized. Add workers if
// throughput ever matters more than subscription rate limits.
export class JobQueue<I, R> {
  private readonly jobs = new Map<string, Job<R>>();
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly work: (input: I) => Promise<R>) {}

  enqueue(input: I): string {
    const job: Job<R> = { id: randomUUID(), status: "queued" };
    this.jobs.set(job.id, job);
    if (this.jobs.size > MAX_JOBS) this.jobs.delete(this.jobs.keys().next().value!);
    this.tail = this.tail.then(async () => {
      job.status = "running";
      try {
        job.result = await this.work(input);
        job.status = "done";
      } catch (err) {
        job.error = err instanceof Error ? err.message : String(err);
        job.status = "error";
      }
    });
    return job.id;
  }

  get(id: string): Job<R> | undefined {
    return this.jobs.get(id);
  }

  idle(): Promise<void> {
    return this.tail;
  }
}
```

- [ ] **Step 4: Run tests** — `pnpm test:bridge`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/src/persist.ts packages/bridge/src/jobs.ts tests/bridge/persist.test.ts tests/bridge/jobs.test.ts
git commit -m "feat: bridge job queue, application folders, applied status"
```

---

### Task 7: bridge tailor job glue

**Files:**
- Create: `packages/bridge/src/tailor-job.ts`
- Modify: `packages/bridge/package.json` (add `"yaml": "^2.3.4"` to dependencies; run `pnpm install`)
- Test: `tests/bridge/tailor-job.test.ts`

**Interfaces:**
- Consumes: `tailorResume`, `runClaude`, `profileName` (skill), `compileLatexWithPages` (lib/local), persist helpers.
- Produces:
  ```ts
  interface TailorJobResult { result: TailorResult; resumePdf: Buffer; coverLetterPdf?: Buffer }
  makeTailorJob(opts: { dir: string; db?: Db; runner?: ClaudeRunner; compile?: TailorDeps["compile"]; now?: () => Date }): (req: TailorRequest) => Promise<TailorJobResult>
  resumeFileName(first: string, last: string, company: string, title: string): string
  ```

- [ ] **Step 1: Write failing test** — `tests/bridge/tailor-job.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTailorJob, resumeFileName } from "../../packages/bridge/src/tailor-job";

const FIXTURE = fileURLToPath(new URL("../skill/fixtures/resume-master.tex", import.meta.url));

function appDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "am-dir-"));
  copyFileSync(FIXTURE, join(dir, "resume-master.tex"));
  writeFileSync(join(dir, "profile.yaml"), "name: {first: Jane, last: Dev}\n");
  return dir;
}

describe("makeTailorJob", () => {
  it("tailors, saves the application folder, and names the PDF", async () => {
    const dir = appDir();
    const job = makeTailorJob({
      dir,
      now: () => new Date("2026-09-28T10:00:00Z"),
      compile: async (latex) => ({ pdf: Buffer.from(latex.slice(0, 5)), pages: 1 }),
      runner: async () => ({
        edits: [],
        order: [],
        keywords: { injected: [], skipped: [{ keyword: "rust", reason: "none" }] },
        coverLetter: "Dear Hiring Team,",
        answers: [{ fieldId: "q", value: "A" }],
      }),
    });
    const out = await job({
      job: { title: "Platform Eng", company: "Acme", url: "https://x/1", description: "JD text" },
      keywords: ["rust"],
      fields: [],
      wantCoverLetterPdf: false,
    });
    expect(out.result.fileName).toBe("Jane_Dev_Acme_Platform_Eng.pdf");
    expect(out.result.answers).toEqual([{ fieldId: "q", value: "A" }]);
    expect(out.result.hasCoverLetterPdf).toBe(false);
    expect(out.result.savedTo).toBe(join(dir, "applications", "2026-09-28-acme-platform-eng"));
    expect(readFileSync(join(out.result.savedTo, "jd.md"), "utf8")).toBe("JD text");
    expect(existsSync(join(out.result.savedTo, "resume.pdf"))).toBe(true);
  });

  it("fails clearly when the master resume is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "am-empty-"));
    const job = makeTailorJob({ dir, runner: async () => ({}), compile: async () => ({ pdf: Buffer.from(""), pages: 1 }) });
    await expect(
      job({ job: { title: "", company: "", url: "u", description: "" }, keywords: [], fields: [], wantCoverLetterPdf: false }),
    ).rejects.toThrow(/resume-master\.tex/);
  });
});

describe("resumeFileName", () => {
  it("sanitizes and drops empty parts", () => {
    expect(resumeFileName("Ram", "Chawla", "Acme, Inc.", "Sr. SWE / Platform")).toBe(
      "Ram_Chawla_Acme_Inc_Sr_SWE_Platform.pdf",
    );
    expect(resumeFileName("", "", "", "")).toBe("resume.pdf");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm test:bridge -- tailor-job`. Expected: FAIL.

- [ ] **Step 3: Implement** — `packages/bridge/src/tailor-job.ts`:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "../../../lib/local/db";
import type { TailorRequest, TailorResult } from "../../../lib/shared/types";
import { compileLatexWithPages } from "../../../lib/local/compile-latex";
import { tailorResume, type TailorDeps } from "../../skill/src/tailor/run";
import { runClaude, type ClaudeRunner } from "../../skill/src/tailor/claude-cli";
import { profileName } from "../../skill/src/tailor/letter";
import {
  applicationDirName,
  deterministicAppId,
  persistOutput,
  saveApplicationFiles,
} from "./persist";

export interface TailorJobResult {
  result: TailorResult;
  resumePdf: Buffer;
  coverLetterPdf?: Buffer;
}

export function resumeFileName(first: string, last: string, company: string, title: string): string {
  const part = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const name = [first, last, company, title].map(part).filter(Boolean).join("_").slice(0, 100);
  return `${name || "resume"}.pdf`;
}

export function makeTailorJob(opts: {
  dir: string;
  db?: Db;
  runner?: ClaudeRunner;
  compile?: TailorDeps["compile"];
  now?: () => Date;
}) {
  const read = (f: string) => readFile(join(opts.dir, f), "utf8");
  const optional = (f: string) => read(f).catch(() => "");

  return async (req: TailorRequest): Promise<TailorJobResult> => {
    const masterTex = await read("resume-master.tex").catch(() => {
      throw new Error(`Master resume not found at ${join(opts.dir, "resume-master.tex")}`);
    });
    const files = {
      masterTex,
      corpusYaml: await optional("experience.yaml"),
      directives: await optional("generation-directives.md"),
      profileYaml: await optional("profile.yaml"),
    };

    const out = await tailorResume(req, files, {
      runClaude: opts.runner ?? runClaude,
      compile: opts.compile ?? ((latex) => compileLatexWithPages(latex)),
      claudeCwd: opts.dir,
    });

    const { first, last } = profileName(files.profileYaml);
    const savedTo = join(
      opts.dir,
      "applications",
      applicationDirName((opts.now ?? (() => new Date()))(), req.job.company, req.job.title),
    );
    const report = { keywords: out.keywords, edits: out.edits, warnings: out.warnings, answers: out.answers, pages: out.pages };
    await saveApplicationFiles(savedTo, {
      resumeTex: out.tex,
      resumePdf: out.pdf,
      coverLetter: out.coverLetter,
      report,
      jd: req.job.description,
    });

    const applicationId = opts.db
      ? persistOutput(opts.db, {
          jobUrl: req.job.url,
          company: req.job.company,
          jobTitle: req.job.title,
          resumeLatex: out.tex,
          coverLetter: out.coverLetter,
          rewritingReport: { overallConfidence: 1, perBullet: out.edits },
          jobDescription: req.job.description || undefined,
        }).applicationId
      : deterministicAppId(req.job.url);

    return {
      result: {
        applicationId,
        fileName: resumeFileName(first, last, req.job.company, req.job.title),
        coverLetter: out.coverLetter,
        hasCoverLetterPdf: !!out.coverLetterPdf,
        answers: out.answers,
        keywords: out.keywords,
        edits: out.edits,
        warnings: out.warnings,
        pages: out.pages,
        savedTo,
      },
      resumePdf: out.pdf,
      coverLetterPdf: out.coverLetterPdf,
    };
  };
}
```

- [ ] **Step 4: Run tests** — `pnpm install && pnpm test:bridge && pnpm type-check:bridge`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/bridge/package.json pnpm-lock.yaml packages/bridge/src/tailor-job.ts tests/bridge/tailor-job.test.ts
git commit -m "feat: bridge tailor job — read ~/.applymate, tailor, save, name PDF"
```

---

### Task 8: bridge routes, pairing, persistent token

**Files:**
- Modify: `packages/bridge/src/server.ts`, `packages/bridge/src/start.ts`
- Test: `tests/bridge/tailor-routes.test.ts`

**Interfaces:**
- Consumes: `JobQueue`, `TailorJobResult`, `markApplied`.
- Produces: `ServerOptions` gains `tailor?: (req: TailorRequest) => Promise<TailorJobResult>`, `profilePath?: string`, `pairFile?: string`. Routes: `GET /pair` → `{ token }`; `POST /tailor` → 202 `{ jobId }`; `GET /tailor/:id` → `{ status, error?, result? }`; `GET /tailor/:id/resume.pdf|cover-letter.pdf`; `GET /profile`; `POST /applications/applied` → `{ applicationId }`. Also exports `validateTailorRequest(x: unknown): TailorRequest | string`.

- [ ] **Step 1: Write failing tests** — `tests/bridge/tailor-routes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { request, type Server } from "node:http";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, validateTailorRequest } from "../../packages/bridge/src/server";
import { OutputStore } from "../../packages/bridge/src/store";
import type { TailorRequest } from "../../lib/shared/types";

const TOKEN = "t0ken";
const dir = mkdtempSync(join(tmpdir(), "am-routes-"));
const profilePath = join(dir, "profile.yaml");
const pairFile = join(dir, "paired-extension");
writeFileSync(profilePath, "name: {first: Jane}\nanswers: []\n");

let server: Server;
let port = 0;
const auth = { authorization: `Bearer ${TOKEN}` };
const body: TailorRequest = {
  job: { title: "SRE", company: "Acme", url: "https://x/1", description: "" },
  keywords: ["go"],
  fields: [],
  wantCoverLetterPdf: true,
};

function raw(path: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET", headers: { host: "127.0.0.1", ...headers } }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
    });
    req.on("error", reject);
    req.end();
  });
}

beforeAll(async () => {
  server = createServer(new OutputStore(), {
    token: TOKEN,
    profilePath,
    pairFile,
    tailor: async (req) => {
      if (req.job.company === "Boom") throw new Error("claude timed out after 180s");
      return {
        result: {
          applicationId: "app_1", fileName: "Jane_Dev.pdf", coverLetter: "Dear", hasCoverLetterPdf: true,
          answers: [], keywords: { injected: [], skipped: [] }, edits: [], warnings: [], pages: 1, savedTo: "/tmp/x",
        },
        resumePdf: Buffer.from("%PDF-resume"),
        coverLetterPdf: Buffer.from("%PDF-letter"),
      };
    },
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  port = typeof addr === "object" && addr ? addr.port : 0;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const base = () => `http://127.0.0.1:${port}`;
async function waitDone(jobId: string) {
  for (let i = 0; i < 50; i++) {
    const s = await (await fetch(`${base()}/tailor/${jobId}`, { headers: auth })).json();
    if (s.status === "done" || s.status === "error") return s;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("job never finished");
}

describe("pairing", () => {
  it("refuses non-extension origins", async () => {
    expect((await raw("/pair", { origin: "https://evil.com" })).status).toBe(403);
  });
  it("hands the token to the first extension and locks to it", async () => {
    const first = await raw("/pair", { origin: "chrome-extension://abc" });
    expect(first.status).toBe(200);
    expect(JSON.parse(first.body).token).toBe(TOKEN);
    expect(readFileSync(pairFile, "utf8")).toBe("chrome-extension://abc");
    expect((await raw("/pair", { origin: "chrome-extension://abc" })).status).toBe(200);
    expect((await raw("/pair", { origin: "chrome-extension://other" })).status).toBe(403);
  });
});

describe("tailor routes", () => {
  it("requires the token", async () => {
    const res = await fetch(`${base()}/tailor`, { method: "POST", body: JSON.stringify(body) });
    expect(res.status).toBe(401);
  });

  it("rejects malformed requests", async () => {
    const res = await fetch(`${base()}/tailor`, { method: "POST", headers: auth, body: JSON.stringify({ job: 1 }) });
    expect(res.status).toBe(400);
  });

  it("queues a job, reports the result, and serves both PDFs", async () => {
    const res = await fetch(`${base()}/tailor`, { method: "POST", headers: auth, body: JSON.stringify(body) });
    expect(res.status).toBe(202);
    const { jobId } = await res.json();
    const done = await waitDone(jobId);
    expect(done.result.fileName).toBe("Jane_Dev.pdf");
    expect(done.result.resumePdf).toBeUndefined();
    const pdf = await fetch(`${base()}/tailor/${jobId}/resume.pdf`, { headers: auth });
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).toString()).toBe("%PDF-resume");
    const letter = await fetch(`${base()}/tailor/${jobId}/cover-letter.pdf`, { headers: auth });
    expect(Buffer.from(await letter.arrayBuffer()).toString()).toBe("%PDF-letter");
  });

  it("surfaces job errors", async () => {
    const res = await fetch(`${base()}/tailor`, {
      method: "POST", headers: auth, body: JSON.stringify({ ...body, job: { ...body.job, company: "Boom" } }),
    });
    const done = await waitDone((await res.json()).jobId);
    expect(done).toMatchObject({ status: "error", error: "claude timed out after 180s" });
  });

  it("404s unknown jobs", async () => {
    expect((await fetch(`${base()}/tailor/nope`, { headers: auth })).status).toBe(404);
  });
});

describe("profile + applied", () => {
  it("serves the parsed profile", async () => {
    const p = await (await fetch(`${base()}/profile`, { headers: auth })).json();
    expect(p.name.first).toBe("Jane");
  });
  it("accepts an applied mark", async () => {
    const res = await fetch(`${base()}/applications/applied`, {
      method: "POST", headers: auth, body: JSON.stringify({ jobUrl: "https://x/1", company: "Acme", jobTitle: "SRE" }),
    });
    expect(res.status).toBe(200);
  });
});

describe("validateTailorRequest", () => {
  it("normalizes keywords and fields", () => {
    const v = validateTailorRequest({
      job: { title: "T", company: "C", url: "u" },
      keywords: [" go ", "", 3],
      fields: [{ fieldId: "a", label: "A", type: "text", required: true }, { nope: 1 }],
    });
    expect(typeof v).toBe("object");
    if (typeof v === "object") {
      expect(v.job.description).toBe("");
      expect(v.keywords).toEqual(["go"]);
      expect(v.fields).toHaveLength(1);
      expect(v.wantCoverLetterPdf).toBe(false);
    }
  });
  it("rejects a missing job url", () => {
    expect(validateTailorRequest({ job: { title: "T" } })).toMatch(/job\.url/);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm test:bridge -- tailor-routes`. Expected: FAIL.

- [ ] **Step 3: Implement server changes** — in `packages/bridge/src/server.ts`:

Add imports:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { parse as parseYaml } from "yaml";
import { JobQueue } from "./jobs";
import { markApplied } from "./persist";
import type { TailorJobResult } from "./tailor-job";
import type { TailorRequest } from "../../../lib/shared/types";
```

(merge `readFileSync` into the existing `node:fs` import). Extend `ServerOptions`:

```ts
  // One-click tailoring: runs behind an async job queue (MV3 service workers
  // can die during a single 60s fetch, so the extension polls instead).
  tailor?: (req: TailorRequest) => Promise<TailorJobResult>;
  // ~/.applymate/profile.yaml, served to the extension for instant fill.
  profilePath?: string;
  // Records the first extension origin that paired (trust on first use).
  pairFile?: string;
```

Add helpers above `createServer`:

```ts
const MAX_BODY = 1_000_000;

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
  });
}

const s = (v: unknown): string => (typeof v === "string" ? v : "");

export function validateTailorRequest(x: unknown): TailorRequest | string {
  const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const job = (r.job && typeof r.job === "object" ? r.job : null) as Record<string, unknown> | null;
  if (!job || !s(job.url)) return "job.url is required";
  const fields = (Array.isArray(r.fields) ? r.fields : [])
    .filter((f): f is Record<string, unknown> => !!f && typeof f === "object" && !!s((f as Record<string, unknown>).fieldId))
    .slice(0, 60)
    .map((f) => ({
      fieldId: s(f.fieldId),
      label: s(f.label).slice(0, 500),
      type: s(f.type) || "text",
      options: Array.isArray(f.options) ? f.options.filter((o): o is string => typeof o === "string").slice(0, 200) : undefined,
      required: f.required === true,
    }));
  return {
    job: { title: s(job.title), company: s(job.company), url: s(job.url), description: s(job.description).slice(0, 30_000) },
    keywords: (Array.isArray(r.keywords) ? r.keywords : [])
      .filter((k): k is string => typeof k === "string")
      .map((k) => k.trim())
      .filter(Boolean)
      .slice(0, 30),
    fields,
    wantCoverLetterPdf: r.wantCoverLetterPdf === true,
  };
}
```

Inside `createServer`, before `return createHttpServer(...)`:

```ts
  const jobs = options.tailor ? new JobQueue<TailorRequest, TailorJobResult>(options.tailor) : null;
```

Inside the handler, **after** the `/health` route and **before** the token check, add pairing:

```ts
    // Pairing hands the token to the extension so the user never pastes it.
    // Only chrome-extension:// origins (web pages can't forge Origin), and
    // only the first one to ask — later origins are refused.
    if (req.method === "GET" && url === "/pair") {
      const origin = req.headers.origin ?? "";
      if (!options.token || !options.pairFile || !origin.startsWith("chrome-extension://")) {
        return send(403, { error: "pairing unavailable" });
      }
      let paired = "";
      try {
        paired = readFileSync(options.pairFile, "utf8").trim();
      } catch {
        /* first pairing */
      }
      if (paired && paired !== origin) {
        return send(403, { error: "bridge is paired with another extension — run `pnpm bridge:unpair`" });
      }
      if (!paired) writeFileSync(options.pairFile, origin, { mode: 0o600 });
      return send(200, { token: options.token });
    }
```

**After** the token check, add:

```ts
    if (req.method === "POST" && url === "/tailor") {
      if (!jobs) return send(503, { error: "tailoring not configured" });
      readJson(req).then(
        (parsed) => {
          const valid = validateTailorRequest(parsed);
          if (typeof valid === "string") return send(400, { error: valid });
          return send(202, { jobId: jobs.enqueue(valid) });
        },
        (err: Error) => send(400, { error: err.message }),
      );
      return;
    }

    const jobMatch = url.match(/^\/tailor\/([\w-]+)(?:\/(resume|cover-letter)\.pdf)?$/);
    if (req.method === "GET" && jobMatch && jobs) {
      const job = jobs.get(jobMatch[1]);
      if (!job) return send(404, { error: "unknown job" });
      if (jobMatch[2]) {
        const bytes = jobMatch[2] === "resume" ? job.result?.resumePdf : job.result?.coverLetterPdf;
        if (!bytes) return send(404, { error: "pdf not ready" });
        res.writeHead(200, { "content-type": "application/pdf", ...cors });
        res.end(bytes);
        return;
      }
      return send(200, { status: job.status, error: job.error, result: job.result?.result });
    }

    if (req.method === "GET" && url === "/profile") {
      if (!options.profilePath) return send(404, { error: "no profile configured" });
      try {
        return send(200, parseYaml(readFileSync(options.profilePath, "utf8")) ?? {});
      } catch {
        return send(404, { error: "profile not found — run `pnpm profile:init`", path: options.profilePath });
      }
    }

    if (req.method === "POST" && url === "/applications/applied") {
      readJson(req).then(
        (parsed) => {
          const p = (parsed ?? {}) as Record<string, unknown>;
          if (!s(p.jobUrl)) return send(400, { error: "jobUrl is required" });
          const applicationId = options.db
            ? markApplied(options.db, { jobUrl: s(p.jobUrl), company: s(p.company), jobTitle: s(p.jobTitle) })
            : null;
          return send(200, { applicationId });
        },
        (err: Error) => send(400, { error: err.message }),
      );
      return;
    }
```

- [ ] **Step 4: Persistent token + wiring** — replace `packages/bridge/src/start.ts`:

```ts
import { randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createServer } from "./server";
import { OutputStore } from "./store";
import { makeTailorJob } from "./tailor-job";
import { openDb, migrate } from "../../../lib/local/db";

const PORT = Number(process.env.APPLYMATE_BRIDGE_PORT ?? 4179);
const dir = process.env.APPLYMATE_DIR ?? join(homedir(), ".applymate");
mkdirSync(dir, { recursive: true });

// Reuse the token across restarts so the extension stays paired.
const tokenPath = join(dir, "bridge-token");
function loadToken(): string {
  if (process.env.APPLYMATE_BRIDGE_TOKEN) return process.env.APPLYMATE_BRIDGE_TOKEN;
  try {
    const existing = readFileSync(tokenPath, "utf8").trim();
    if (existing) return existing;
  } catch {
    /* first run */
  }
  const fresh = randomBytes(24).toString("hex");
  writeFileSync(tokenPath, fresh, { mode: 0o600 });
  return fresh;
}
const token = loadToken();

const db = openDb();
migrate(db);
const server = createServer(new OutputStore(), {
  token,
  db,
  tailor: makeTailorJob({ dir, db }),
  profilePath: join(dir, "profile.yaml"),
  pairFile: join(dir, "paired-extension"),
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[ApplyMate] bridge listening on http://127.0.0.1:${PORT}`);
  console.log(`[ApplyMate] token in ${tokenPath} (the extension pairs automatically)`);
});
```

- [ ] **Step 5: Run tests** — `pnpm test:bridge && pnpm type-check:bridge`. Expected: PASS (existing server tests still pass).

- [ ] **Step 6: Commit**

```bash
git add packages/bridge/src/server.ts packages/bridge/src/start.ts tests/bridge/tailor-routes.test.ts
git commit -m "feat: bridge tailor/profile/applied routes, TOFU pairing, persistent token"
```

---

### Task 9: profile init, launchd agent, smoke script, scripts

**Files:**
- Create: `packages/bridge/src/profile-init.ts`, `packages/bridge/src/install-launchd.ts`, `packages/bridge/src/smoke.ts`
- Modify: `packages/bridge/package.json`, root `package.json`
- Test: `tests/bridge/profile-init.test.ts`

**Interfaces:**
- Produces: `buildProfile(corpusYaml: string, masterTex: string): Record<string, unknown>`, `PROFILE_HEADER: string`, `plistXml(o: { node: string; bridgeDir: string; home: string; path: string }): string`.

- [ ] **Step 1: Write failing tests** — `tests/bridge/profile-init.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildProfile } from "../../packages/bridge/src/profile-init";
import { plistXml } from "../../packages/bridge/src/install-launchd";

const tex = readFileSync(
  fileURLToPath(new URL("../skill/fixtures/resume-master.tex", import.meta.url)),
  "utf8",
);
const corpus = `profile:
  name: Jane Q Dev
  current_title: Senior Software Engineer
  org: Acme Corp — Platform
  email: jane@example.com
`;

describe("buildProfile", () => {
  const p = buildProfile(corpus, tex) as Record<string, any>;
  it("splits the name and copies contact info", () => {
    expect(p.name).toEqual({ first: "Jane", last: "Q Dev", preferred: "Jane" });
    expect(p.email).toBe("jane@example.com");
  });
  it("pulls links from the resume header", () => {
    expect(p.links.github).toBe("https://github.com/janedev");
    expect(p.links.portfolio).toBe("https://example.com");
  });
  it("fills current role and education", () => {
    expect(p.current).toEqual({ company: "Acme Corp", title: "Senior Software Engineer" });
    expect(p.education.school).toBe("State University");
    expect(p.education.start).toBe("2014");
    expect(p.education.end).toBe("2018");
    expect(p.education.major).toBe("Computer Science");
  });
  it("defaults EEO answers to decline and seeds answer rules", () => {
    expect(p.eeo.gender).toBe("Decline to self-identify");
    expect(p.answers[0].match).toMatch(/hear/);
  });
});

describe("plistXml", () => {
  it("runs the bridge with node + tsx and a usable PATH, escaping XML", () => {
    const x = plistXml({ node: "/usr/bin/node", bridgeDir: "/a&b/bridge", home: "/Users/me", path: "/opt/homebrew/bin:/usr/bin" });
    expect(x).toContain("<string>com.applymate.bridge</string>");
    expect(x).toContain("<string>/a&amp;b/bridge</string>");
    expect(x).toContain("<string>--import</string>");
    expect(x).toContain("<string>/opt/homebrew/bin:/usr/bin</string>");
    expect(x).toContain("<key>KeepAlive</key><true/>");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm test:bridge -- profile-init`. Expected: FAIL.

- [ ] **Step 3: Implement** — `packages/bridge/src/profile-init.ts`:

```ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";

const DECLINE = "Decline to self-identify";

export const PROFILE_HEADER = `# ApplyMate profile — used to autofill applications instantly.
# answers: first rule whose "match" (case-insensitive regex) hits a question label wins.
`;

export function buildProfile(corpusYaml: string, masterTex: string): Record<string, unknown> {
  const doc = (parse(corpusYaml) ?? {}) as { profile?: Record<string, unknown> };
  const p = doc.profile ?? {};
  const [first = "", ...rest] = String(p.name ?? "").trim().split(/\s+/);
  const hrefs = [...masterTex.matchAll(/\\href\{([^}]+)\}/g)].map((m) => m[1]);
  const find = (re: RegExp) => hrefs.find((h) => re.test(h)) ?? "";
  const edu = masterTex.match(/\\section\{Education\}[\s\S]*?\\resumeSubheading\s*\{([^}]*)\}\{([^}]*)\}/);
  const years = edu?.[2].match(/(\d{4})\D+(\d{4})/);

  return {
    name: { first, last: rest.join(" "), preferred: first },
    email: String(p.email ?? ""),
    phone: "",
    address: { street: "", city: "", state: "", zip: "", country: "" },
    location: "",
    links: {
      linkedin: find(/linkedin\.com/),
      github: find(/github\.com/),
      portfolio: hrefs.find((h) => !/^mailto:|linkedin\.com|github\.com/.test(h)) ?? "",
    },
    current: {
      company: String(p.org ?? "").split(/\s+[—–-]\s+/)[0],
      title: String(p.current_title ?? ""),
    },
    education: {
      school: edu?.[1].trim() ?? "",
      degree: "",
      major: masterTex.match(/\\textbf\{([^}]+)\}\s*\(major\)/)?.[1] ?? "",
      gpa: "",
      start: years?.[1] ?? "",
      end: years?.[2] ?? "",
    },
    work_auth: { authorized: "", sponsorship: "" },
    start_date: "",
    salary: "",
    relocate: "",
    eeo: { pronouns: "", gender: DECLINE, race: DECLINE, hispanic: DECLINE, veteran: DECLINE, disability: DECLINE },
    answers: [
      { match: "how did you (hear|find|learn)", answer: "LinkedIn" },
      { match: "previously (worked|been employed)", answer: "No" },
    ],
  };
}

if (process.argv[1]?.endsWith("profile-init.ts")) {
  const dir = process.env.APPLYMATE_DIR ?? join(homedir(), ".applymate");
  const out = join(dir, "profile.yaml");
  if (existsSync(out)) {
    console.log(`${out} already exists — leaving it untouched.`);
  } else {
    const read = (f: string) => {
      try {
        return readFileSync(join(dir, f), "utf8");
      } catch {
        return "";
      }
    };
    writeFileSync(out, PROFILE_HEADER + stringify(buildProfile(read("experience.yaml"), read("resume-master.tex"))));
    console.log(`Wrote ${out}. Fill in phone, address, work_auth, start_date, salary.`);
  }
}
```

`packages/bridge/src/install-launchd.ts`:

```ts
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LABEL = "com.applymate.bridge";
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// launchd starts agents with a bare PATH (/usr/bin:/bin:…) — the bridge needs
// the caller's PATH to find `claude` and `tectonic` in /opt/homebrew/bin.
export function plistXml(o: { node: string; bridgeDir: string; home: string; path: string }): string {
  const str = (v: string) => `<string>${xml(v)}</string>`;
  const log = `${o.home}/.applymate/bridge.log`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key>${str(LABEL)}
<key>ProgramArguments</key><array>${[o.node, "--import", "tsx", "src/start.ts"].map(str).join("")}</array>
<key>WorkingDirectory</key>${str(o.bridgeDir)}
<key>EnvironmentVariables</key><dict><key>PATH</key>${str(o.path)}<key>HOME</key>${str(o.home)}</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>StandardOutPath</key>${str(log)}
<key>StandardErrorPath</key>${str(log)}
</dict></plist>
`;
}

if (process.argv[1]?.endsWith("install-launchd.ts")) {
  const home = homedir();
  const plistPath = join(home, "Library", "LaunchAgents", `${LABEL}.plist`);
  const bridgeDir = join(dirname(fileURLToPath(import.meta.url)), "..");
  mkdirSync(dirname(plistPath), { recursive: true });
  mkdirSync(join(home, ".applymate"), { recursive: true });
  writeFileSync(plistPath, plistXml({ node: process.execPath, bridgeDir, home, path: process.env.PATH ?? "/usr/bin:/bin" }));
  const domain = `gui/${userInfo().uid}`;
  try {
    execFileSync("launchctl", ["bootout", `${domain}/${LABEL}`], { stdio: "ignore" });
  } catch {
    /* not loaded yet */
  }
  execFileSync("launchctl", ["bootstrap", domain, plistPath]);
  console.log(`Installed ${plistPath}; bridge starts at login and restarts on crash. Logs: ~/.applymate/bridge.log`);
}
```

`packages/bridge/src/smoke.ts`:

```ts
// Real end-to-end check: real `claude -p` + real tectonic on your real files.
// Usage: pnpm tailor:smoke [path/to/jd.txt]
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { makeTailorJob } from "./tailor-job";

const SAMPLE_JD = `Senior Platform Engineer. Build internal developer platforms on Kubernetes,
own CI/CD (GitHub Actions), infrastructure as code (Terraform), observability, and
secure service-to-service auth. 5+ years. Bonus: LLM tooling and MCP.`;

const dir = process.env.APPLYMATE_DIR ?? join(homedir(), ".applymate");
const description = process.argv[2] ? await readFile(process.argv[2], "utf8") : SAMPLE_JD;
const started = Date.now();
const { result } = await makeTailorJob({ dir })({
  job: { title: "Senior Platform Engineer", company: "SmokeTest", url: "https://example.com/smoke", description },
  keywords: ["terraform", "kubernetes"],
  fields: [
    { fieldId: "why", label: "Why do you want to work here?", type: "textarea", required: true },
    { fieldId: "auth", label: "Are you legally authorized to work in Canada?", type: "select", options: ["Yes", "No"], required: true },
  ],
  wantCoverLetterPdf: true,
});
console.log(`done in ${Math.round((Date.now() - started) / 1000)}s — ${result.pages} page(s) → ${result.savedTo}`);
console.log(`edits: ${result.edits.length} (${result.edits.filter((e) => e.reverted).length} reverted)`);
console.log(`injected: ${result.keywords.injected.map((k) => `${k.keyword}@${k.where}`).join(", ") || "-"}`);
console.log(`skipped: ${result.keywords.skipped.map((k) => `${k.keyword} (${k.reason})`).join("; ") || "-"}`);
for (const w of result.warnings) console.log(`warn: ${w}`);
for (const a of result.answers) console.log(`answer ${a.fieldId}: ${a.value}`);
if (result.pages !== 1) process.exit(1);
```

- [ ] **Step 4: Scripts** — `packages/bridge/package.json` scripts become:

```json
    "start": "tsx src/start.ts",
    "test": "vitest run",
    "type-check": "tsc --noEmit",
    "install-agent": "tsx src/install-launchd.ts",
    "profile-init": "tsx src/profile-init.ts",
    "smoke": "tsx src/smoke.ts",
    "unpair": "node -e \"require('fs').rmSync(require('os').homedir()+'/.applymate/paired-extension',{force:true})\""
```

Root `package.json` scripts add:

```json
    "bridge:install": "pnpm --filter @applymate/bridge install-agent",
    "bridge:unpair": "pnpm --filter @applymate/bridge unpair",
    "profile:init": "pnpm --filter @applymate/bridge profile-init",
    "tailor:smoke": "pnpm --filter @applymate/bridge smoke",
```

- [ ] **Step 5: Run tests** — `pnpm test:bridge && pnpm type-check:bridge`. Expected: PASS.

- [ ] **Step 6: Real smoke run** (uses the subscription once, ~30-90s; run unsandboxed):

Run: `pnpm profile:init && pnpm tailor:smoke`
Expected: `done in Ns — 1 page(s) → ~/.applymate/applications/…-smoketest-senior-platform-engineer`, non-empty injected list, both answers present (auth answer exactly `Yes` or `No`), cover letter in `cover-letter.md` not in caveman style. Render `resume.pdf` to PNG (`pdftoppm -r 70 -png -singlefile`) and eyeball it. Fix prompt/checks if anything is off before continuing.

- [ ] **Step 7: Commit**

```bash
git add packages/bridge package.json tests/bridge/profile-init.test.ts
git commit -m "feat: profile init, launchd agent installer, real tailor smoke run"
```

---

### Task 10: extension — live-DOM extraction, fill engine, profile mapping

**Files:**
- Create: `packages/extension/src/content/dom.ts`
- Rewrite: `packages/extension/src/content/extractors/form.ts`, `packages/extension/src/content/fill.ts`, `packages/extension/src/lib/field-mapping.ts`
- Modify: `lib/shared/types.ts` (FormField), `lib/shared/constants.ts`, `packages/extension/src/types.ts`, `packages/extension/src/utils/profile.ts`
- Test (rewrite/replace): `tests/extension/form.test.ts`, `tests/extension/fill.test.ts`, `tests/extension/field-mapping.test.ts`; delete `tests/extension/pipeline.e2e.test.ts` and `tests/extension/messaging.test.ts` (they test removed APIs; Task 12 adds the replacement end-to-end test)

**Interfaces:**
- Produces:
  - `dom.ts`: `FIELD_ATTR = "data-applymate-id"`, `cssEscape(v)`, `setNativeValue(el, v)`, `setNativeChecked(el, on)`, `fireEvents(el, types)`, `cleanText(s)`, `sleep(ms)`.
  - `form.ts`: `extractLiveFields(doc: Document): FormField[]`, `extractFormFields(html: string): FormField[]`, `inferValueType(label: string, htmlType: string, autocomplete: string, type: FormField["type"]): { valueType: string | null; confidence: number }`.
  - `fill.ts`: `FillInstruction { fieldId: string; value: string }`, `findField(doc, id): HTMLElement | null`, `matchOption(options: string[], wanted: string): number`, `applyFill(ins: FillInstruction[], doc): Promise<{ filled: string[]; missing: string[] }>`, `attachFile(input: HTMLInputElement, file: File): boolean`, `highlightEmptyRequired(doc, fields: FormField[]): string[]`.
  - `field-mapping.ts`: `ruleAnswer(label, rules): string | null`, `profileValue(field, profile): string | null`, `buildInstantPlan(fields, profile): { instructions: FillInstruction[]; pending: FormField[] }`.
  - `profile.ts`: `EMPTY_PROFILE`, `normalizeProfile(raw: unknown): Profile`, `getProfile()`, `saveProfile(p)`.
  - `Profile` (extension `types.ts`), nested exactly like `profile.yaml`.

- [ ] **Step 1: Widen shared types/constants**

In `lib/shared/types.ts`, change `FormField.type` to add `"combobox" | "date" | "number" | "url"` and `extractedValueType` to `string | null` (keep `?`).

Replace `FIELD_TYPE_KEYWORDS`/`VALUE_TYPES` in `lib/shared/constants.ts` with:

```ts
// Order matters: the first matching type wins, so specific types precede the
// generic ones that would shadow them (company name before name, LinkedIn
// before website, location before city).
export const FIELD_TYPE_KEYWORDS: Record<string, string[]> = {
  "preferred-name": ["preferred name", "preferred first name", "nickname"],
  "first-name": ["first name", "given name", "forename", "legal first name"],
  "last-name": ["last name", "family name", "surname", "legal last name"],
  email: ["email address", "email", "e-mail"],
  phone: ["phone number", "phone", "contact number", "mobile", "telephone"],
  linkedin: ["linkedin"],
  github: ["github"],
  "cover-letter": ["cover letter"],
  resume: ["resume", "résumé", "cv", "curriculum vitae"],
  sponsorship: ["sponsorship", "sponsor", "require a visa", "visa status"],
  "work-auth": ["authorized to work", "authorised to work", "work authorization", "work authorisation", "legally eligible", "eligible to work", "right to work", "legally authorized"],
  pronouns: ["pronoun", "pronouns"],
  gender: ["gender", "sex"],
  hispanic: ["hispanic", "latino", "latinx", "latine"],
  race: ["race", "ethnicity", "ethnic background"],
  veteran: ["veteran", "protected veteran", "military service"],
  disability: ["disability", "disabled"],
  "how-heard": ["how did you hear", "how did you find", "where did you hear", "hear about", "learn about this"],
  "start-date": ["start date", "earliest start", "available to start", "when can you start", "notice period"],
  salary: ["salary", "compensation", "pay expectation", "desired pay", "expected pay"],
  relocate: ["relocate", "relocation", "relocating"],
  "current-company": ["current company", "current employer", "most recent employer", "company name", "employer"],
  "current-title": ["current title", "current job title", "current role", "job title", "title"],
  school: ["school", "university", "college", "institution"],
  degree: ["degree"],
  major: ["major", "field of study", "discipline", "area of study"],
  gpa: ["gpa", "grade point"],
  "grad-date": ["graduation", "grad date", "graduation year", "year of graduation"],
  address: ["street address", "address line", "address 1", "address"],
  location: ["current location", "location", "where are you based", "based in"],
  city: ["city", "town"],
  state: ["state", "province", "region"],
  zip: ["zip", "postal"],
  country: ["country"],
  website: ["portfolio", "personal website", "personal site", "website", "url", "link"],
  name: ["full name", "your name", "legal name", "applicant name", "name"],
};

// Types whose questions are often long sentences. Everything else only
// matches short labels, so "Have you worked for this employer before?"
// never becomes current-company.
export const LONG_LABEL_TYPES = new Set([
  "work-auth", "sponsorship", "pronouns", "gender", "hispanic", "race", "veteran",
  "disability", "how-heard", "start-date", "salary", "relocate", "cover-letter", "resume",
]);
export const SHORT_LABEL_MAX = 50;

// HTML autocomplete tokens → value types (the strongest signal when present).
export const AUTOCOMPLETE_TYPES: Record<string, string> = {
  "given-name": "first-name",
  "family-name": "last-name",
  name: "name",
  nickname: "preferred-name",
  email: "email",
  tel: "phone",
  "tel-national": "phone",
  "street-address": "address",
  "address-line1": "address",
  "address-level2": "city",
  "address-level1": "state",
  "postal-code": "zip",
  country: "country",
  "country-name": "country",
  organization: "current-company",
  "organization-title": "current-title",
  url: "website",
};
```

Delete `VALUE_TYPES` (only the deleted `FormValidation` side-panel component used it — confirm with `grep -rn VALUE_TYPES packages lib`).

- [ ] **Step 2: Profile type** — replace `Profile`, `FillInstruction`, `FillPlan`, `ApplyFillPlanMessage`, `MessageFromContent`, `MessageFromBackground`, `SidePanelState` in `packages/extension/src/types.ts` with:

```ts
export type {
  ExtractedJobData,
  FormField,
  DetectionResult,
  TailorRequest,
  TailorResult,
  TailorQuestion,
  RunReport,
} from "../../../lib/shared/types";

export interface Profile {
  name: { first: string; last: string; preferred: string };
  email: string;
  phone: string;
  address: { street: string; city: string; state: string; zip: string; country: string };
  location: string;
  links: { linkedin: string; github: string; portfolio: string };
  current: { company: string; title: string };
  education: { school: string; degree: string; major: string; gpa: string; start: string; end: string };
  work_auth: { authorized: string; sponsorship: string };
  start_date: string;
  salary: string;
  relocate: string;
  eeo: { pronouns: string; gender: string; race: string; hispanic: string; veteran: string; disability: string };
  answers: { match: string; answer: string }[];
}
```

Replace `packages/extension/src/utils/profile.ts`:

```ts
import type { Profile } from "../types";

export const EMPTY_PROFILE: Profile = {
  name: { first: "", last: "", preferred: "" },
  email: "",
  phone: "",
  address: { street: "", city: "", state: "", zip: "", country: "" },
  location: "",
  links: { linkedin: "", github: "", portfolio: "" },
  current: { company: "", title: "" },
  education: { school: "", degree: "", major: "", gpa: "", start: "", end: "" },
  work_auth: { authorized: "", sponsorship: "" },
  start_date: "",
  salary: "",
  relocate: "",
  eeo: { pronouns: "", gender: "", race: "", hispanic: "", veteran: "", disability: "" },
  answers: [],
};

// profile.yaml is hand-edited: coerce every leaf to a string and drop
// malformed answer rules instead of trusting the shape.
export function normalizeProfile(raw: unknown): Profile {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, template] of Object.entries(EMPTY_PROFILE)) {
    const value = src[key];
    if (key === "answers") {
      out.answers = (Array.isArray(value) ? value : [])
        .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
        .map((r) => ({ match: String(r.match ?? ""), answer: String(r.answer ?? "") }))
        .filter((r) => r.match);
    } else if (typeof template === "string") {
      out[key] = value == null ? "" : String(value);
    } else {
      const nested = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
      out[key] = Object.fromEntries(
        Object.keys(template as object).map((k) => [k, nested[k] == null ? "" : String(nested[k])]),
      );
    }
  }
  return out as unknown as Profile;
}

export function getProfile(): Promise<Profile> {
  return new Promise((resolve) => {
    chrome.storage.local.get("profile", (result) => resolve(normalizeProfile(result.profile)));
  });
}

export function saveProfile(profile: Profile): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set({ profile }, () => resolve()));
}
```

- [ ] **Step 3: Write failing extraction tests** — replace `tests/extension/form.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  extractLiveFields,
  inferValueType,
} from "../../packages/extension/src/content/extractors/form";

function doc(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
}

describe("extractLiveFields", () => {
  it("stamps controls with stable ids, reusing id/name and generating the rest", () => {
    const d = doc(`<input id="email" type="email"><input name="phone" type="tel"><input type="text" placeholder="City">`);
    const ids = extractLiveFields(d).map((f) => f.id);
    expect(ids[0]).toBe("email");
    expect(ids[1]).toBe("phone");
    expect(ids[2]).toMatch(/^am-/);
    expect(d.querySelectorAll("[data-applymate-id]")).toHaveLength(3);
    expect(extractLiveFields(d).map((f) => f.id)).toEqual(ids);
  });

  it("skips hidden, submit and button inputs", () => {
    const d = doc(`<input type="hidden" name="h"><input type="submit"><input type="button"><input name="x">`);
    expect(extractLiveFields(d).map((f) => f.id)).toEqual(["x"]);
  });

  it("resolves labels from for=, wrapping label, aria-labelledby, aria-label", () => {
    const d = doc(`
      <label for="a">First Name</label><input id="a">
      <label>Last Name <input id="b"></label>
      <span id="lc">Current Company</span><input id="c" aria-labelledby="lc">
      <input id="d" aria-label="LinkedIn Profile">`);
    expect(extractLiveFields(d).map((f) => [f.label, f.extractedValueType])).toEqual([
      ["First Name", "first-name"],
      ["Last Name", "last-name"],
      ["Current Company", "current-company"],
      ["LinkedIn Profile", "linkedin"],
    ]);
  });

  it("uses Lever-style sibling question text", () => {
    const d = doc(`
      <li class="application-question">
        <div class="application-label">Why do you want to join?</div>
        <div class="application-field"><textarea name="cards[0]"></textarea></div>
      </li>`);
    const [f] = extractLiveFields(d);
    expect(f.label).toBe("Why do you want to join?");
    expect(f.extractedValueType).toBe("custom-q");
  });

  it("collapses a radio group into one field with question and options", () => {
    const d = doc(`
      <fieldset><legend>Are you legally authorized to work in the United States? *</legend>
        <label><input type="radio" name="auth" value="1"> Yes</label>
        <label><input type="radio" name="auth" value="0"> No</label>
      </fieldset>`);
    const fields = extractLiveFields(d);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      id: "auth",
      type: "radio",
      label: "Are you legally authorized to work in the United States?",
      options: ["Yes", "No"],
      required: true,
      extractedValueType: "work-auth",
    });
  });

  it("lists select options without placeholders and reads aria-required", () => {
    const d = doc(`<label for="g">Gender</label>
      <select id="g" aria-required="true"><option value="">Select...</option><option>Male</option><option>Female</option><option>Decline to self-identify</option></select>`);
    const [f] = extractLiveFields(d);
    expect(f.options).toEqual(["Male", "Female", "Decline to self-identify"]);
    expect(f.required).toBe(true);
    expect(f.extractedValueType).toBe("gender");
  });

  it("marks ARIA comboboxes", () => {
    const d = doc(`<label for="loc">Location (City)</label><input id="loc" role="combobox">`);
    expect(extractLiveFields(d)[0]).toMatchObject({ type: "combobox", extractedValueType: "location" });
  });

  it("extracts non-native ARIA radiogroups", () => {
    const d = doc(`<div role="radiogroup" aria-label="Will you require sponsorship?">
      <div role="radio">Yes</div><div role="radio">No</div></div>`);
    expect(extractLiveFields(d)[0]).toMatchObject({ type: "radio", options: ["Yes", "No"], extractedValueType: "sponsorship" });
  });
});

describe("inferValueType", () => {
  const t = (label: string, htmlType = "text", ac = "", type: any = "text") =>
    inferValueType(label.toLowerCase(), htmlType, ac, type).valueType;
  it("prefers autocomplete tokens", () => {
    expect(t("Field 1", "text", "given-name")).toBe("first-name");
    expect(t("x", "text", "section-a address-level2")).toBe("city");
  });
  it("classifies file inputs", () => {
    expect(t("Resume/CV", "file")).toBe("resume");
    expect(t("Cover Letter", "file")).toBe("cover-letter");
  });
  it("handles long question labels", () => {
    expect(t("Will you now or in the future require sponsorship for employment visa status (e.g., H-1B)?")).toBe("sponsorship");
    expect(t("Have you previously worked for this employer or any of its subsidiaries?")).toBe("custom-q");
    expect(t("Please describe your experience with open source software", "text", "", "textarea")).toBe("custom-q");
  });
  it("respects word boundaries and ordering", () => {
    expect(t("Location (City)")).toBe("location");
    expect(t("Company name")).toBe("current-company");
    expect(t("Personal statement")).toBeNull();
    expect(t("Email", "email")).toBe("email");
  });
});
```

- [ ] **Step 4: Implement `dom.ts`**:

```ts
export const FIELD_ATTR = "data-applymate-id";

export function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\\]]/g, "\\$&");
}

export function cleanText(s: string): string {
  return s.replace(/\s+/g, " ").replace(/\s*\*\s*$/, "").trim().slice(0, 300);
}

type Valued = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

// Controlled (React/Vue) inputs shadow `.value`; writing through the
// prototype's native setter makes the framework see the change when events fire.
export function setNativeValue(el: Valued, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el) as object, "value");
  if (descriptor?.set) descriptor.set.call(el, value);
  else el.value = value;
}

export function setNativeChecked(el: HTMLInputElement, checked: boolean): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el) as object, "checked");
  if (descriptor?.set) descriptor.set.call(el, checked);
  else el.checked = checked;
}

// Mouse events must be MouseEvents with button 0 — react-select ignores
// plain Events on mousedown.
export function fireEvents(el: Element, types: string[]): void {
  for (const type of types) {
    const init = { bubbles: true, cancelable: true };
    el.dispatchEvent(
      type === "click" || type.startsWith("mouse")
        ? new MouseEvent(type, { ...init, button: 0 })
        : new Event(type, init),
    );
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
```

- [ ] **Step 5: Implement `form.ts`** (replace file):

```ts
import type { FormField } from "../../../../../lib/shared/types";
import {
  AUTOCOMPLETE_TYPES,
  FIELD_TYPE_KEYWORDS,
  LONG_LABEL_TYPES,
  SHORT_LABEL_MAX,
} from "../../../../../lib/shared/constants";
import { FIELD_ATTR, cleanText, cssEscape } from "../dom";

const SKIP_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "search"]);
const QUESTION_SELECTOR =
  "label, legend, [class*='label'], [class*='Label'], [class*='question'], [class*='Question']";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasPhrase(text: string, phrase: string): boolean {
  return new RegExp(`(^|[^a-z])${escapeRe(phrase)}($|[^a-z])`).test(text);
}

export function inferValueType(
  label: string,
  htmlType: string,
  autocomplete: string,
  type: FormField["type"],
): { valueType: string | null; confidence: number } {
  const token = autocomplete.toLowerCase().trim().split(/\s+/).pop() ?? "";
  if (AUTOCOMPLETE_TYPES[token]) return { valueType: AUTOCOMPLETE_TYPES[token], confidence: 0.95 };

  const text = label.toLowerCase();
  if (htmlType === "file") {
    return { valueType: /cover/.test(text) ? "cover-letter" : "resume", confidence: 0.9 };
  }
  for (const [valueType, phrases] of Object.entries(FIELD_TYPE_KEYWORDS)) {
    if (text.length > SHORT_LABEL_MAX && !LONG_LABEL_TYPES.has(valueType)) continue;
    if (phrases.some((p) => hasPhrase(text, p))) return { valueType, confidence: 0.8 };
  }
  if (htmlType === "email") return { valueType: "email", confidence: 0.9 };
  if (htmlType === "tel") return { valueType: "phone", confidence: 0.9 };
  if (type === "textarea" || text.endsWith("?") || text.length > SHORT_LABEL_MAX) {
    return { valueType: "custom-q", confidence: 0.5 };
  }
  return { valueType: null, confidence: 0 };
}

function labelledBy(el: Element, doc: Document): string {
  const ids = el.getAttribute("aria-labelledby");
  if (!ids) return "";
  return ids
    .split(/\s+/)
    .map((id) => doc.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
}

// Closest label-like element that precedes `el`, isn't its container, and
// doesn't belong to another control or to an option of a choice group.
function questionText(el: Element, exclude: (c: Element) => boolean): string {
  let node = el.parentElement;
  for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
    const candidates = Array.from(node.querySelectorAll(QUESTION_SELECTOR)).filter(
      (c) =>
        !c.contains(el) &&
        !exclude(c) &&
        (c.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 &&
        (c.textContent ?? "").trim() !== "",
    );
    const nearest = candidates[candidates.length - 1];
    if (nearest) return nearest.textContent ?? "";
  }
  return "";
}

function rawLabel(el: HTMLElement, doc: Document): string {
  if (el.id) {
    const l = doc.querySelector(`label[for="${cssEscape(el.id)}"]`);
    if (l?.textContent?.trim()) return l.textContent;
  }
  const wrap = el.closest("label");
  if (wrap?.textContent?.trim()) return wrap.textContent;
  const byIds = labelledBy(el, doc);
  if (byIds) return byIds;
  const aria = el.getAttribute("aria-label");
  if (aria?.trim()) return aria;
  const legend = el.closest("fieldset")?.querySelector("legend");
  if (legend?.textContent?.trim()) return legend.textContent;
  const q = questionText(el, (c) => {
    const f = c.getAttribute("for");
    return c.tagName === "LABEL" && !!f && f !== el.id;
  });
  return q || el.getAttribute("placeholder") || el.getAttribute("name") || "";
}

function groupRawLabel(first: HTMLElement, doc: Document): string {
  const legend = first.closest("fieldset")?.querySelector("legend");
  if (legend?.textContent?.trim()) return legend.textContent;
  const byIds = labelledBy(first.closest("[aria-labelledby]") ?? first, doc);
  if (byIds) return byIds;
  return questionText(first, (c) => !!c.querySelector("input[type=radio], input[type=checkbox]") || (c.tagName === "LABEL" && !!c.getAttribute("for")));
}

function optionLabel(input: HTMLInputElement, doc: Document): string {
  if (input.id) {
    const l = doc.querySelector(`label[for="${cssEscape(input.id)}"]`);
    if (l?.textContent?.trim()) return cleanText(l.textContent);
  }
  return cleanText(input.closest("label")?.textContent ?? input.value);
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}#${i}`;
  used.add(id);
  return id;
}

export function extractLiveFields(doc: Document): FormField[] {
  const fields: FormField[] = [];
  const used = new Set<string>();
  const seenGroups = new Set<string>();
  let anon = 0;
  const nextAnon = () => `am-${anon++}`;

  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("input, textarea, select"))) {
    const tag = el.tagName.toLowerCase();
    const htmlType = (el.getAttribute("type") ?? "").toLowerCase();
    if (tag === "input" && SKIP_TYPES.has(htmlType)) continue;

    const input = el as HTMLInputElement;
    const groupInputs =
      (htmlType === "radio" || htmlType === "checkbox") && input.name
        ? Array.from(doc.querySelectorAll<HTMLInputElement>(`input[type=${htmlType}][name="${cssEscape(input.name)}"]`))
        : [];
    const isGroup = htmlType === "radio" ? groupInputs.length > 0 : groupInputs.length > 1;
    if (isGroup) {
      const key = `${htmlType}:${input.name}`;
      if (seenGroups.has(key)) continue;
      seenGroups.add(key);
    }

    const id = uniqueId(
      el.getAttribute(FIELD_ATTR) ?? ((isGroup ? input.name : el.id || el.getAttribute("name")) || nextAnon()),
      used,
    );
    for (const target of isGroup ? groupInputs : [el]) target.setAttribute(FIELD_ATTR, id);

    const type: FormField["type"] =
      tag === "textarea" ? "textarea"
      : tag === "select" ? "select"
      : el.getAttribute("role") === "combobox" ? "combobox"
      : (["email", "tel", "file", "checkbox", "radio", "date", "number", "url"].includes(htmlType)
          ? (htmlType as FormField["type"])
          : "text");

    const raw = isGroup ? groupRawLabel(el, doc) : rawLabel(el, doc);
    const label = cleanText(raw);
    const options =
      tag === "select"
        ? Array.from((el as HTMLSelectElement).options)
            .map((o) => cleanText(o.text))
            .filter((t) => t && !/^(select|please select|choose|--)/i.test(t))
        : isGroup
          ? groupInputs.map((r) => optionLabel(r, doc))
          : undefined;
    const { valueType, confidence } = inferValueType(label, htmlType, el.getAttribute("autocomplete") ?? "", type);

    fields.push({
      id,
      label,
      type,
      placeholder: el.getAttribute("placeholder") ?? "",
      required:
        el.hasAttribute("required") ||
        el.getAttribute("aria-required") === "true" ||
        groupInputs.some((r) => r.required) ||
        /\*\s*$/.test(raw.trim()),
      options,
      extractedValueType: valueType,
      matchConfidence: confidence,
      validated: false,
    });
  }

  // Non-native choice groups (custom radio widgets).
  for (const group of Array.from(doc.querySelectorAll<HTMLElement>("[role=radiogroup]"))) {
    if (group.querySelector("input")) continue;
    const radios = Array.from(group.querySelectorAll<HTMLElement>("[role=radio]"));
    if (radios.length === 0) continue;
    const id = uniqueId(group.getAttribute(FIELD_ATTR) ?? nextAnon(), used);
    group.setAttribute(FIELD_ATTR, id);
    const raw = group.getAttribute("aria-label") || labelledBy(group, doc) || questionText(group, () => false);
    const label = cleanText(raw);
    const { valueType, confidence } = inferValueType(label, "radio", "", "radio");
    fields.push({
      id,
      label,
      type: "radio",
      required: group.getAttribute("aria-required") === "true" || /\*\s*$/.test(raw.trim()),
      options: radios.map((r) => cleanText(r.getAttribute("aria-label") ?? r.textContent ?? "")),
      extractedValueType: valueType,
      matchConfidence: confidence,
      validated: false,
    });
  }

  return fields;
}

export function extractFormFields(html: string): FormField[] {
  return extractLiveFields(new DOMParser().parseFromString(html, "text/html"));
}
```

- [ ] **Step 6: Run extraction tests** — `pnpm test:extension -- form`. Expected: PASS. (If a label test fails, fix the resolver, not the test — these shapes are the real Greenhouse/Lever ones.)

- [ ] **Step 7: Write failing fill + mapping tests** — replace `tests/extension/fill.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  applyFill,
  attachFile,
  matchOption,
  highlightEmptyRequired,
} from "../../packages/extension/src/content/fill";
import { extractLiveFields } from "../../packages/extension/src/content/extractors/form";

function doc(html: string): Document {
  const d = document.implementation.createHTMLDocument("t");
  d.body.innerHTML = html;
  return d;
}

describe("matchOption", () => {
  const opts = ["Yes, I am authorized", "No", "Not a protected veteran", "I don't wish to answer", "Canada"];
  it.each([
    ["yes", 0],
    ["No", 1],
    ["Decline to self-identify", 3],
    ["Toronto, Ontario, Canada", 4],
    ["", -1],
    ["Purple", -1],
  ])("%s → %i", (wanted, idx) => {
    expect(matchOption(opts, wanted as string)).toBe(idx);
  });
  it("prefers exact over prefix", () => {
    expect(matchOption(["Not applicable", "No"], "no")).toBe(1);
  });
  it("matches the city head of a location against suggestions", () => {
    expect(matchOption(["Toronto, ON, Canada", "Torino, Italy"], "Toronto, Ontario")).toBe(0);
  });
});

describe("applyFill", () => {
  it("fills text, textarea, select, radio group, checkbox by applymate id", async () => {
    const d = doc(`
      <input id="n"><textarea id="t"></textarea>
      <select id="s"><option value="">Select</option><option value="y">Yes, I am</option><option value="n">No</option></select>
      <label><input type="radio" name="r" value="a">Yes</label><label><input type="radio" name="r" value="b">No</label>
      <input type="checkbox" id="c">`);
    extractLiveFields(d);
    const res = await applyFill(
      [
        { fieldId: "n", value: "Jane" },
        { fieldId: "t", value: "Long answer" },
        { fieldId: "s", value: "Yes" },
        { fieldId: "r", value: "No" },
        { fieldId: "c", value: "yes" },
      ],
      d,
    );
    expect(res.missing).toEqual([]);
    expect((d.getElementById("n") as HTMLInputElement).value).toBe("Jane");
    expect((d.getElementById("t") as HTMLTextAreaElement).value).toBe("Long answer");
    expect((d.getElementById("s") as HTMLSelectElement).value).toBe("y");
    expect((d.querySelector("input[value=b]") as HTMLInputElement).checked).toBe(true);
    expect((d.getElementById("c") as HTMLInputElement).checked).toBe(true);
  });

  it("reports missing fields and unmatched options", async () => {
    const d = doc(`<select id="s"><option>A</option></select>`);
    extractLiveFields(d);
    const res = await applyFill([{ fieldId: "s", value: "Z" }, { fieldId: "ghost", value: "x" }], d);
    expect(res.missing).toEqual(["s", "ghost"]);
  });

  it("clicks the matching option in an ARIA radiogroup", async () => {
    const d = doc(`<div role="radiogroup" aria-label="Sponsor?"><div role="radio">Yes</div><div role="radio">No</div></div>`);
    extractLiveFields(d);
    const clicked: string[] = [];
    d.querySelectorAll("[role=radio]").forEach((r) => r.addEventListener("click", () => clicked.push(r.textContent!)));
    await applyFill([{ fieldId: "am-0", value: "No" }], d);
    expect(clicked).toEqual(["No"]);
  });

  it("drives a react-select style combobox", async () => {
    const d = doc(`<label for="cb">Gender</label><div class="ctl"><input id="cb" role="combobox"></div><div id="menu"></div><input type="hidden" id="val">`);
    const input = d.getElementById("cb") as HTMLInputElement;
    const menu = d.getElementById("menu")!;
    const render = (filter: string) => {
      menu.innerHTML = "";
      for (const o of ["Male", "Female", "I don't wish to answer"]) {
        if (filter && !o.toLowerCase().includes(filter.toLowerCase())) continue;
        const el = d.createElement("div");
        el.setAttribute("role", "option");
        el.textContent = o;
        el.addEventListener("click", () => ((d.getElementById("val") as HTMLInputElement).value = o));
        menu.appendChild(el);
      }
    };
    input.addEventListener("keydown", (e) => (e as KeyboardEvent).key === "ArrowDown" && setTimeout(() => render(""), 20));
    input.addEventListener("input", () => setTimeout(() => render(input.value), 20));
    extractLiveFields(d);
    const res = await applyFill([{ fieldId: "cb", value: "Decline to self-identify" }], d);
    expect(res.filled).toEqual(["cb"]);
    expect((d.getElementById("val") as HTMLInputElement).value).toBe("I don't wish to answer");
  });
});

describe("attachFile", () => {
  it("sets files through DataTransfer and fires change", () => {
    const d = doc(`<input type="file" id="f">`);
    const input = d.getElementById("f") as HTMLInputElement;
    let assigned: unknown = null;
    Object.defineProperty(input, "files", { set: (v) => (assigned = v), get: () => assigned, configurable: true });
    class FakeDT {
      private list: File[] = [];
      items = { add: (f: File) => this.list.push(f) };
      get files() {
        return this.list;
      }
    }
    vi.stubGlobal("DataTransfer", FakeDT);
    const onChange = vi.fn();
    input.addEventListener("change", onChange);
    expect(attachFile(input, new File(["%PDF"], "r.pdf", { type: "application/pdf" }))).toBe(true);
    expect((assigned as File[])[0].name).toBe("r.pdf");
    expect(onChange).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("returns false when DataTransfer is unavailable", () => {
    const d = doc(`<input type="file" id="f">`);
    vi.stubGlobal("DataTransfer", undefined);
    expect(attachFile(d.getElementById("f") as HTMLInputElement, new File(["x"], "x.pdf"))).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("highlightEmptyRequired", () => {
  it("outlines required fields still empty", () => {
    const d = doc(`<input id="a" required><input id="b" required value="x"><input id="c">`);
    const fields = extractLiveFields(d);
    expect(highlightEmptyRequired(d, fields)).toEqual(["a"]);
    expect((d.getElementById("a") as HTMLElement).style.outline).toContain("solid");
  });
});
```

Replace `tests/extension/field-mapping.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  buildInstantPlan,
  profileValue,
  ruleAnswer,
} from "../../packages/extension/src/lib/field-mapping";
import { normalizeProfile } from "../../packages/extension/src/utils/profile";
import type { FormField } from "../../packages/extension/src/types";

const profile = normalizeProfile({
  name: { first: "Jane", last: "Dev" },
  email: "jane@example.com",
  address: { city: "Toronto", state: "ON" },
  links: { linkedin: "https://linkedin.com/in/jane" },
  work_auth: { authorized: "Yes", sponsorship: "No" },
  eeo: { gender: "Decline to self-identify" },
  answers: [{ match: "how did you (hear|find)", answer: "LinkedIn" }, { match: "([bad", answer: "Literal" }],
});

const field = (label: string, extractedValueType: string | null, type: FormField["type"] = "text"): FormField => ({
  id: label, label, type, required: false, extractedValueType, matchConfidence: 0.8, validated: false,
});

describe("normalizeProfile", () => {
  it("fills missing keys with empty strings and drops bad rules", () => {
    const p = normalizeProfile({ name: "oops", answers: [{ answer: "x" }, null] });
    expect(p.name).toEqual({ first: "", last: "", preferred: "" });
    expect(p.answers).toEqual([]);
    expect(p.eeo.veteran).toBe("");
  });
});

describe("profileValue", () => {
  it("maps value types to profile fields", () => {
    expect(profileValue(field("First Name", "first-name"), profile)).toBe("Jane");
    expect(profileValue(field("Name", "name"), profile)).toBe("Jane Dev");
    expect(profileValue(field("Preferred", "preferred-name"), profile)).toBe("Jane");
    expect(profileValue(field("Location", "location"), profile)).toBe("Toronto, ON");
    expect(profileValue(field("Sponsorship?", "sponsorship"), profile)).toBe("No");
    expect(profileValue(field("Gender", "gender"), profile)).toBe("Decline to self-identify");
  });
  it("returns null for empty profile values and unknown types", () => {
    expect(profileValue(field("Phone", "phone"), profile)).toBeNull();
    expect(profileValue(field("Favorite color", null), profile)).toBeNull();
  });
  it("lets answer rules win, falling back to substring for invalid regex", () => {
    expect(ruleAnswer("How did you hear about us?", profile.answers)).toBe("LinkedIn");
    expect(ruleAnswer("Pick ([bad option", profile.answers)).toBe("Literal");
    expect(profileValue(field("How did you find this job?", "how-heard"), profile)).toBe("LinkedIn");
  });
});

describe("buildInstantPlan", () => {
  it("splits fields into instant values and pending questions, skipping files", () => {
    const plan = buildInstantPlan(
      [field("Email", "email"), field("Why us?", "custom-q", "textarea"), field("Resume", "resume", "file"), field("Phone", "phone")],
      profile,
    );
    expect(plan.instructions).toEqual([{ fieldId: "Email", value: "jane@example.com" }]);
    expect(plan.pending.map((f) => f.id)).toEqual(["Why us?", "Phone"]);
  });
});
```

- [ ] **Step 8: Implement `fill.ts`** (replace file):

```ts
import type { FormField } from "../types";
import { FIELD_ATTR, cssEscape, fireEvents, setNativeChecked, setNativeValue, sleep } from "./dom";

export interface FillInstruction {
  fieldId: string;
  value: string;
}

export interface FillResult {
  filled: string[];
  missing: string[];
}

export function findField(doc: Document, fieldId: string): HTMLElement | null {
  return (
    doc.querySelector<HTMLElement>(`[${FIELD_ATTR}="${cssEscape(fieldId)}"]`) ??
    doc.getElementById(fieldId) ??
    doc.querySelector<HTMLElement>(`[name="${cssEscape(fieldId)}"]`)
  );
}

const DECLINE = /decline|prefer not|don.?t wish|do not wish|not to (say|answer|disclose)|rather not/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Index of the option that best matches `wanted`, or -1. Options rarely match
// profile values verbatim ("Yes, I am authorized", "I don't wish to answer").
export function matchOption(options: string[], wanted: string): number {
  const w = wanted.trim().toLowerCase();
  if (!w) return -1;
  const opts = options.map((o) => o.trim().toLowerCase());
  let i = opts.indexOf(w);
  if (i !== -1) return i;
  const word = new RegExp(`^${escapeRe(w)}\\b`);
  i = opts.findIndex((o) => word.test(o));
  if (i !== -1) return i;
  i = opts.findIndex((o) => o.includes(w));
  if (i !== -1) return i;
  const head = w.split(",")[0].trim();
  if (head && head !== w) {
    i = opts.findIndex((o) => o.startsWith(head));
    if (i !== -1) return i;
  }
  i = opts.findIndex((o) => o.length > 2 && w.includes(o));
  if (i !== -1) return i;
  return DECLINE.test(w) ? opts.findIndex((o) => DECLINE.test(o)) : -1;
}

const textOf = (el: Element) =>
  (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim();

function labelOf(input: HTMLInputElement): string {
  if (input.id) {
    const l = input.ownerDocument.querySelector(`label[for="${cssEscape(input.id)}"]`);
    if (l?.textContent) return l.textContent.trim();
  }
  return (input.closest("label")?.textContent ?? input.value).trim();
}

function clickMatching(els: HTMLElement[], value: string): boolean {
  const i = matchOption(els.map(textOf), value);
  if (i === -1) return false;
  fireEvents(els[i], ["mousedown", "mouseup", "click"]);
  return true;
}

function fillSelect(el: HTMLSelectElement, value: string): boolean {
  const options = Array.from(el.options);
  let i = matchOption(options.map((o) => o.text), value);
  if (i === -1) i = matchOption(options.map((o) => o.value), value);
  if (i === -1) return false;
  setNativeValue(el, options[i].value);
  fireEvents(el, ["input", "change", "blur"]);
  return true;
}

function group(el: HTMLInputElement): HTMLInputElement[] {
  return el.name
    ? Array.from(
        el.ownerDocument.querySelectorAll<HTMLInputElement>(`input[type=${el.type}][name="${cssEscape(el.name)}"]`),
      )
    : [el];
}

function fillRadio(el: HTMLInputElement, value: string): boolean {
  const radios = group(el);
  const i = matchOption(radios.map(labelOf), value);
  if (i === -1) return false;
  setNativeChecked(radios[i], true);
  fireEvents(radios[i], ["click", "input", "change"]);
  return true;
}

function fillCheckbox(el: HTMLInputElement, value: string): boolean {
  const boxes = group(el);
  if (boxes.length > 1) {
    const labels = boxes.map(labelOf);
    let any = false;
    for (const part of value.split(/[,;]/)) {
      const i = matchOption(labels, part);
      if (i !== -1 && !boxes[i].checked) {
        fireEvents(boxes[i], ["click"]);
        if (!boxes[i].checked) setNativeChecked(boxes[i], true);
        fireEvents(boxes[i], ["change"]);
        any = true;
      }
    }
    return any;
  }
  const on = /^(yes|true|1|on|checked|i agree|agree)/i.test(value.trim());
  if (el.checked !== on) {
    setNativeChecked(el, on);
    fireEvents(el, ["click", "input", "change"]);
  }
  return true;
}

const OPTION_SELECTOR = "[role=option], [id*='-option-'], .select__option";

async function waitForMatch(doc: Document, value: string, ms: number): Promise<HTMLElement | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const options = Array.from(doc.querySelectorAll<HTMLElement>(OPTION_SELECTOR));
    const i = matchOption(options.map(textOf), value);
    if (i !== -1) return options[i];
    if (Date.now() > deadline) return null;
    await sleep(50);
  }
}

// react-select / Ashby / async location pickers: open the menu and pick from
// the full list; if nothing matches, type the value (city head for
// locations) to trigger search and pick from the results.
async function fillCombobox(input: HTMLInputElement, value: string): Promise<boolean> {
  const doc = input.ownerDocument;
  input.focus();
  fireEvents(input, ["mousedown"]);
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  let pick = await waitForMatch(doc, value, 600);
  if (!pick) {
    setNativeValue(input, value.split(",")[0].trim());
    fireEvents(input, ["input"]);
    pick = await waitForMatch(doc, value, 2500);
  }
  if (!pick) {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return false;
  }
  fireEvents(pick, ["mousedown", "mouseup", "click"]);
  return true;
}

async function fillElement(el: HTMLElement, value: string): Promise<boolean> {
  if (el.getAttribute("role") === "radiogroup") {
    return clickMatching(Array.from(el.querySelectorAll<HTMLElement>("[role=radio]")), value);
  }
  if (el instanceof HTMLSelectElement) return fillSelect(el, value);
  if (el instanceof HTMLInputElement) {
    if (el.type === "file") return false;
    if (el.type === "radio") return fillRadio(el, value);
    if (el.type === "checkbox") return fillCheckbox(el, value);
    if (el.getAttribute("role") === "combobox") return fillCombobox(el, value);
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();
    setNativeValue(el, value);
    fireEvents(el, ["input", "change", "blur"]);
    return true;
  }
  return false;
}

export async function applyFill(instructions: FillInstruction[], doc: Document): Promise<FillResult> {
  const filled: string[] = [];
  const missing: string[] = [];
  for (const ins of instructions) {
    const el = findField(doc, ins.fieldId);
    if (el && ins.value.trim() && (await fillElement(el, ins.value))) filled.push(ins.fieldId);
    else missing.push(ins.fieldId);
  }
  return { filled, missing };
}

export function attachFile(input: HTMLInputElement, file: File): boolean {
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
  } catch {
    return false;
  }
  fireEvents(input, ["input", "change"]);
  return true;
}

function isEmpty(el: HTMLElement): boolean {
  if (el.getAttribute("role") === "radiogroup") return !el.querySelector("[aria-checked=true]");
  if (el instanceof HTMLInputElement) {
    if (el.type === "radio" || el.type === "checkbox") return !group(el).some((r) => r.checked);
    if (el.type === "file") return !el.files || el.files.length === 0;
    if (el.getAttribute("role") === "combobox") return false; // value lives elsewhere
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el.value.trim() === "";
  }
  return false;
}

export function highlightEmptyRequired(doc: Document, fields: FormField[]): string[] {
  const empty: string[] = [];
  for (const f of fields) {
    if (!f.required) continue;
    const el = findField(doc, f.id);
    if (!el || !isEmpty(el)) continue;
    el.style.outline = "3px solid #facc15";
    el.style.outlineOffset = "1px";
    empty.push(f.id);
  }
  return empty;
}
```

- [ ] **Step 9: Implement `field-mapping.ts`** (replace file):

```ts
import type { FormField, Profile } from "../types";
import type { FillInstruction } from "../content/fill";

const GETTERS: Record<string, (p: Profile) => string> = {
  "first-name": (p) => p.name.first,
  "last-name": (p) => p.name.last,
  "preferred-name": (p) => p.name.preferred || p.name.first,
  name: (p) => `${p.name.first} ${p.name.last}`.trim(),
  email: (p) => p.email,
  phone: (p) => p.phone,
  address: (p) => p.address.street,
  city: (p) => p.address.city,
  state: (p) => p.address.state,
  zip: (p) => p.address.zip,
  country: (p) => p.address.country,
  location: (p) => p.location || [p.address.city, p.address.state].filter(Boolean).join(", "),
  linkedin: (p) => p.links.linkedin,
  github: (p) => p.links.github,
  website: (p) => p.links.portfolio,
  "current-company": (p) => p.current.company,
  "current-title": (p) => p.current.title,
  school: (p) => p.education.school,
  degree: (p) => p.education.degree,
  major: (p) => p.education.major,
  gpa: (p) => p.education.gpa,
  "grad-date": (p) => p.education.end,
  "work-auth": (p) => p.work_auth.authorized,
  sponsorship: (p) => p.work_auth.sponsorship,
  "start-date": (p) => p.start_date,
  salary: (p) => p.salary,
  relocate: (p) => p.relocate,
  pronouns: (p) => p.eeo.pronouns,
  gender: (p) => p.eeo.gender,
  race: (p) => p.eeo.race,
  hispanic: (p) => p.eeo.hispanic,
  veteran: (p) => p.eeo.veteran,
  disability: (p) => p.eeo.disability,
};

export function ruleAnswer(label: string, rules: Profile["answers"]): string | null {
  for (const r of rules) {
    let hit: boolean;
    try {
      hit = new RegExp(r.match, "i").test(label);
    } catch {
      hit = label.toLowerCase().includes(r.match.toLowerCase());
    }
    if (hit) return r.answer;
  }
  return null;
}

export function profileValue(field: FormField, profile: Profile): string | null {
  const rule = ruleAnswer(field.label, profile.answers);
  if (rule !== null) return rule;
  const type = field.userSelectedValueType ?? field.extractedValueType;
  const value = type ? GETTERS[type]?.(profile).trim() : "";
  return value ? value : null;
}

const MAX_PENDING = 40;

// Instant values come from the profile; everything else (custom questions,
// unmapped dropdowns) goes to Claude with the tailoring request. File inputs
// are handled by the attach step.
export function buildInstantPlan(
  fields: FormField[],
  profile: Profile,
): { instructions: FillInstruction[]; pending: FormField[] } {
  const instructions: FillInstruction[] = [];
  const pending: FormField[] = [];
  for (const f of fields) {
    if (f.type === "file") continue;
    const value = profileValue(f, profile);
    if (value !== null) instructions.push({ fieldId: f.id, value });
    else if (pending.length < MAX_PENDING) pending.push(f);
  }
  return { instructions, pending };
}
```

- [ ] **Step 10: Remove obsolete tests; run** — `git rm tests/extension/pipeline.e2e.test.ts tests/extension/messaging.test.ts`, then `pnpm test:extension`. Expected: form/fill/field-mapping PASS. `content.ts`/side panel compile errors are expected until Tasks 11-13 (tests don't import them).

- [ ] **Step 11: Commit**

```bash
git add -A lib/shared packages/extension/src/content/dom.ts packages/extension/src/content/extractors/form.ts packages/extension/src/content/fill.ts packages/extension/src/lib/field-mapping.ts packages/extension/src/types.ts packages/extension/src/utils/profile.ts tests/extension
git commit -m "feat: live-DOM field extraction, widget-aware fill engine, Simplify-level profile mapping"
```

---

### Task 11: JD cache + bridge client + background proxy

**Files:**
- Create: `packages/extension/src/lib/jd-cache.ts`
- Rewrite: `packages/extension/src/utils/bridge.ts`, `packages/extension/src/background.ts`
- Test: `tests/extension/jd-cache.test.ts`, `tests/extension/bridge-client.test.ts`

**Interfaces:**
- Produces:
  - `jobKey(url: string): string`, `pickJD(page: PageJD, store: { cache: Record<string, CachedJD>; overrides: Record<string, string> }, now: number, ignoreRecent?: boolean): { jd: PageJD; source: JDSource }`, `rememberJD(cache, entry, now): Record<string, CachedJD>`, types `PageJD = { url; title; company; description }`, `CachedJD = PageJD & { key: string; seenAt: number }`, `JDSource = "override" | "page" | "cached" | "recent" | "none"`, `RECENT_MS`.
  - `BRIDGE_BASE`, `getBridgeToken()`, `saveBridgeToken(t)`, `pair(): Promise<string>`, `bridgeFetch(path, init?): Promise<Response>`, `isBridgeUp()`.
  - Background messages (all answered async; errors come back as `{ error: string }`): `GET_PROFILE → Profile`, `TAILOR_START { request: TailorRequest } → { jobId }`, `TAILOR_POLL { jobId } → { status, error?, result? }`, `FETCH_PDF { jobId, kind: "resume" | "cover-letter" } → { base64 }`, `MARK_APPLIED { jobUrl, company, jobTitle } → { ok }`, `RUN_REPORT { report: RunReport } → { ok }`, `OPEN_SIDE_PANEL → {}`.

- [ ] **Step 1: Write failing tests** — `tests/extension/jd-cache.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { jobKey, pickJD, rememberJD, RECENT_MS } from "../../packages/extension/src/lib/jd-cache";

const longJD = "x".repeat(250);

describe("jobKey", () => {
  it.each([
    ["https://jobs.lever.co/acme/123/apply", "jobs.lever.co/acme/123"],
    ["https://jobs.ashbyhq.com/acme/abc/application?utm=x", "jobs.ashbyhq.com/acme/abc"],
    ["https://acme.com/careers?gh_jid=42&utm_source=li", "acme.com/careers?gh_jid=42"],
    ["https://Job-Boards.greenhouse.io/acme/jobs/9/", "job-boards.greenhouse.io/acme/jobs/9"],
    ["not a url", "not a url"],
  ])("%s → %s", (url, key) => expect(jobKey(url)).toBe(key));
});

describe("pickJD", () => {
  const now = 1_000_000_000;
  const cached = rememberJD({}, { url: "https://jobs.lever.co/acme/123", title: "SRE", company: "Acme", description: longJD }, now - 1000);
  const empty = { url: "https://jobs.lever.co/acme/123/apply", title: "", company: "", description: "" };

  it("prefers a user override", () => {
    const r = pickJD(empty, { cache: cached, overrides: { "jobs.lever.co/acme/123": "pasted" } }, now);
    expect(r).toMatchObject({ source: "override", jd: { description: "pasted" } });
  });
  it("uses the page JD when long enough", () => {
    expect(pickJD({ ...empty, description: longJD }, { cache: {}, overrides: {} }, now).source).toBe("page");
  });
  it("uses the posting cached under the same job key", () => {
    expect(pickJD(empty, { cache: cached, overrides: {} }, now)).toMatchObject({
      source: "cached",
      jd: { title: "SRE", company: "Acme", description: longJD },
    });
  });
  it("falls back to the most recent JD within 30 minutes", () => {
    const other = { ...empty, url: "https://boards.greenhouse.io/embed/job_app?for=acme" };
    expect(pickJD(other, { cache: cached, overrides: {} }, now).source).toBe("recent");
    expect(pickJD(other, { cache: cached, overrides: {} }, now, true).source).toBe("none");
    expect(pickJD(other, { cache: cached, overrides: {} }, now + RECENT_MS).source).toBe("none");
  });
});

describe("rememberJD", () => {
  it("prunes to the newest 100 and drops week-old entries", () => {
    let cache = rememberJD({}, { url: "https://old.com/1", title: "", company: "", description: "d" }, 0);
    for (let i = 0; i < 105; i++) {
      cache = rememberJD(cache, { url: `https://x.com/${i}`, title: "", company: "", description: "d" }, 8 * 86_400_000 + i);
    }
    expect(Object.keys(cache)).toHaveLength(100);
    expect(cache["old.com/1"]).toBeUndefined();
    expect(cache["x.com/104"]).toBeDefined();
  });
});
```

`tests/extension/bridge-client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

let stored: Record<string, unknown> = {};
beforeEach(() => {
  stored = {};
  vi.resetModules();
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: (key: string, cb: (r: Record<string, unknown>) => void) => cb({ [key]: stored[key] }),
        set: (items: Record<string, unknown>, cb?: () => void) => {
          Object.assign(stored, items);
          cb?.();
        },
      },
    },
  };
});

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; auth?: string }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.authorization });
    return handler(url, init);
  });
  return calls;
}

describe("bridgeFetch", () => {
  it("pairs automatically when no token is stored", async () => {
    const calls = mockFetch((url) =>
      url.endsWith("/pair") ? Response.json({ token: "T1" }) : Response.json({ ok: true }),
    );
    const { bridgeFetch } = await import("../../packages/extension/src/utils/bridge");
    const res = await bridgeFetch("/profile");
    expect(res.ok).toBe(true);
    expect(calls.map((c) => c.url.replace("http://127.0.0.1:4179", ""))).toEqual(["/pair", "/profile"]);
    expect(calls[1].auth).toBe("Bearer T1");
    expect(stored.bridgeToken).toBe("T1");
  });

  it("re-pairs once on 401 (bridge token rotated)", async () => {
    stored.bridgeToken = "OLD";
    mockFetch((url, init) => {
      if (url.endsWith("/pair")) return Response.json({ token: "NEW" });
      const auth = (init?.headers as Record<string, string>).authorization;
      return auth === "Bearer NEW" ? Response.json({ ok: true }) : new Response("no", { status: 401 });
    });
    const { bridgeFetch } = await import("../../packages/extension/src/utils/bridge");
    expect((await bridgeFetch("/profile")).ok).toBe(true);
    expect(stored.bridgeToken).toBe("NEW");
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm test:extension -- jd-cache bridge-client`. Expected: FAIL.

- [ ] **Step 3: Implement `jd-cache.ts`**:

```ts
export interface PageJD {
  url: string;
  title: string;
  company: string;
  description: string;
}

export interface CachedJD extends PageJD {
  key: string;
  seenAt: number;
}

export type JDSource = "override" | "page" | "cached" | "recent" | "none";

export const RECENT_MS = 30 * 60_000;
const MIN_PAGE_JD = 200;
const MAX_AGE_MS = 7 * 86_400_000;
const MAX_ENTRIES = 100;
const KEEP_QUERY = new Set(["gh_jid", "jobid", "jid", "id", "job", "jk", "currentjobid"]);

// Posting and application pages of the same job share a key: Lever/Ashby
// apply pages drop the JD, so the form page looks up the posting's JD by key.
export function jobKey(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/(apply|application)(\/.*)?$/i, "").replace(/\/+$/, "");
    const query = [...u.searchParams]
      .filter(([k]) => KEEP_QUERY.has(k.toLowerCase()))
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join("&");
    return `${u.host.toLowerCase()}${path}${query ? `?${query}` : ""}`;
  } catch {
    return url;
  }
}

export function rememberJD(cache: Record<string, CachedJD>, jd: PageJD, now: number): Record<string, CachedJD> {
  const key = jobKey(jd.url);
  const next = { ...cache, [key]: { ...jd, key, seenAt: now } };
  const kept = Object.values(next)
    .filter((c) => now - c.seenAt < MAX_AGE_MS)
    .sort((a, b) => b.seenAt - a.seenAt)
    .slice(0, MAX_ENTRIES);
  return Object.fromEntries(kept.map((c) => [c.key, c]));
}

export function pickJD(
  page: PageJD,
  store: { cache: Record<string, CachedJD>; overrides: Record<string, string> },
  now: number,
  ignoreRecent = false,
): { jd: PageJD; source: JDSource } {
  const key = jobKey(page.url);
  const merge = (from: PageJD): PageJD => ({
    url: page.url,
    title: page.title || from.title,
    company: page.company || from.company,
    description: from.description,
  });

  const override = store.overrides[key];
  if (override) return { jd: { ...page, description: override }, source: "override" };
  if (page.description.length >= MIN_PAGE_JD) return { jd: page, source: "page" };
  const cached = store.cache[key];
  if (cached) return { jd: merge(cached), source: "cached" };
  if (!ignoreRecent) {
    const recent = Object.values(store.cache)
      .filter((c) => now - c.seenAt < RECENT_MS)
      .sort((a, b) => b.seenAt - a.seenAt)[0];
    if (recent) return { jd: merge(recent), source: "recent" };
  }
  return { jd: { ...page, description: "" }, source: "none" };
}
```

- [ ] **Step 4: Implement `utils/bridge.ts`** (replace file):

```ts
export const BRIDGE_BASE = "http://127.0.0.1:4179";

export function getBridgeToken(): Promise<string> {
  return new Promise((resolve) =>
    chrome.storage.local.get("bridgeToken", (r) => resolve((r.bridgeToken as string) ?? "")),
  );
}

export function saveBridgeToken(token: string): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set({ bridgeToken: token }, () => resolve()));
}

// The bridge hands its token to the first extension origin that asks, so the
// user never copies it by hand.
export async function pair(): Promise<string> {
  try {
    const res = await fetch(`${BRIDGE_BASE}/pair`);
    if (!res.ok) return "";
    const { token } = (await res.json()) as { token?: string };
    if (token) await saveBridgeToken(token);
    return token ?? "";
  } catch {
    return "";
  }
}

export async function bridgeFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let token = await getBridgeToken();
  if (!token) token = await pair();
  const go = (t: string) =>
    fetch(`${BRIDGE_BASE}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), ...(t ? { authorization: `Bearer ${t}` } : {}) },
    });
  let res = await go(token);
  if (res.status === 401) {
    const fresh = await pair();
    if (fresh && fresh !== token) res = await go(fresh);
  }
  return res;
}

export async function isBridgeUp(): Promise<boolean> {
  try {
    return (await fetch(`${BRIDGE_BASE}/health`)).ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Implement `background.ts`** (replace file):

```ts
import { bridgeFetch } from "./utils/bridge";
import { getProfile, normalizeProfile, saveProfile } from "./utils/profile";
import type { Profile, RunReport, TailorRequest } from "./types";

type BgMessage =
  | { type: "GET_PROFILE" }
  | { type: "TAILOR_START"; request: TailorRequest }
  | { type: "TAILOR_POLL"; jobId: string }
  | { type: "FETCH_PDF"; jobId: string; kind: "resume" | "cover-letter" }
  | { type: "MARK_APPLIED"; jobUrl: string; company: string; jobTitle: string }
  | { type: "RUN_REPORT"; report: RunReport }
  | { type: "OPEN_SIDE_PANEL" };

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg: BgMessage, sender, sendResponse) => {
  // sidePanel.open() needs the user gesture that is only alive synchronously.
  if (msg?.type === "OPEN_SIDE_PANEL") {
    if (sender.tab?.id !== undefined) void chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
    sendResponse({});
    return false;
  }
  handle(msg, sender).then(sendResponse, (err: unknown) =>
    sendResponse({ error: err instanceof Error ? err.message : String(err) }),
  );
  return true;
});

async function json(res: Response): Promise<unknown> {
  if (!res.ok) throw new Error(`bridge ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

async function freshProfile(): Promise<Profile> {
  try {
    const res = await bridgeFetch("/profile");
    if (res.ok) {
      const profile = normalizeProfile(await res.json());
      await saveProfile(profile);
      return profile;
    }
  } catch {
    // bridge offline — use the cached copy
  }
  return getProfile();
}

async function handle(msg: BgMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const post = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  switch (msg.type) {
    case "GET_PROFILE":
      return freshProfile();
    case "TAILOR_START":
      return json(await bridgeFetch("/tailor", post(msg.request)));
    case "TAILOR_POLL":
      return json(await bridgeFetch(`/tailor/${encodeURIComponent(msg.jobId)}`));
    case "FETCH_PDF": {
      const res = await bridgeFetch(`/tailor/${encodeURIComponent(msg.jobId)}/${msg.kind}.pdf`);
      if (!res.ok) throw new Error(`bridge ${res.status}`);
      return { base64: toBase64(await res.arrayBuffer()) };
    }
    case "MARK_APPLIED":
      await json(await bridgeFetch("/applications/applied", post(msg)));
      return { ok: true };
    case "RUN_REPORT":
      await chrome.storage.session.set({ [`lastRun:${sender.tab?.id ?? "x"}`]: msg.report });
      return { ok: true };
    default:
      throw new Error("unknown message");
  }
}
```

- [ ] **Step 6: Run tests** — `pnpm test:extension -- jd-cache bridge-client`. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/extension/src/lib/jd-cache.ts packages/extension/src/utils/bridge.ts packages/extension/src/background.ts tests/extension/jd-cache.test.ts tests/extension/bridge-client.test.ts
git commit -m "feat: JD cache across posting/apply pages, auto-pairing bridge client, background proxy"
```

---

### Task 12: in-page widget, one-click orchestration, IIFE content build

**Files:**
- Create: `packages/extension/src/content/widget.ts`, `packages/extension/vite.content.config.ts`
- Rewrite: `packages/extension/src/content/content.ts`
- Modify: `packages/extension/vite.config.ts`, `packages/extension/package.json`, `packages/extension/public/manifest.json`
- Test: `tests/extension/widget.test.ts`, `tests/extension/one-click.test.ts`, `tests/extension/manifest.test.ts` (update)

**Interfaces:**
- Consumes: Tasks 10–11.
- Produces:
  - `widget.ts`: `WidgetState`, `WidgetHandlers { onRun(); onKeywordsChange(k: string[]); onDismissJD(); onOpenPdf(); onDetails(); onToggle() }`, `mountWidget(doc: Document, handlers: WidgetHandlers, placement: "bottom" | "top"): { render(s: WidgetState): void; host: HTMLElement }`, `escapeHtml(s)`.
  - `content.ts`: `isApplicationForm(fields: FormField[]): boolean`, `isSubmitControl(el: Element): boolean`, `isPostingPage(board: string, confidence: number): boolean`, `runOneClick(ctx: OneClickContext): Promise<RunReport>` where `OneClickContext = { doc: Document; fields: FormField[]; jd: PageJD; jdSource: string; keywords: string[]; send: (msg: unknown) => Promise<any>; onStatus: (lines: WidgetState["lines"]) => void; pollMs?: number; settleMs?: number }`.

- [ ] **Step 1: Write failing tests** — `tests/extension/widget.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { mountWidget, escapeHtml, type WidgetState } from "../../packages/extension/src/content/widget";

const base: WidgetState = {
  mode: "form", title: "SRE <script>", company: "Acme", jdSource: "page", keywords: ["go"],
  busy: false, lines: [], injected: [], skipped: [], collapsed: false, canOpenPdf: false,
};

function setup() {
  const handlers = {
    onRun: vi.fn(), onKeywordsChange: vi.fn(), onDismissJD: vi.fn(),
    onOpenPdf: vi.fn(), onDetails: vi.fn(), onToggle: vi.fn(),
  };
  const w = mountWidget(document, handlers, "bottom");
  return { w, handlers, root: w.host.shadowRoot! };
}

describe("widget", () => {
  it("escapes page-controlled text", () => {
    const { w, root } = setup();
    w.render(base);
    expect(root.innerHTML).toContain("SRE &lt;script&gt;");
    expect(root.querySelector("script")).toBeNull();
    expect(escapeHtml(`"&'<>`)).toBe("&quot;&amp;&#39;&lt;&gt;");
  });

  it("fires onRun from the main button and disables it while busy", () => {
    const { w, root, handlers } = setup();
    w.render(base);
    (root.querySelector("[data-action=run]") as HTMLButtonElement).click();
    expect(handlers.onRun).toHaveBeenCalledOnce();
    w.render({ ...base, busy: true });
    expect((root.querySelector("[data-action=run]") as HTMLButtonElement).disabled).toBe(true);
  });

  it("adds keywords on Enter/comma and removes chips", () => {
    const { w, root, handlers } = setup();
    w.render(base);
    const input = root.querySelector("input[data-role=kw]") as HTMLInputElement;
    input.value = "kubernetes, terraform";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(handlers.onKeywordsChange).toHaveBeenLastCalledWith(["go", "kubernetes", "terraform"]);
    (root.querySelector("[data-remove='go']") as HTMLElement).click();
    expect(handlers.onKeywordsChange).toHaveBeenLastCalledWith([]);
  });

  it("shows only a JD pill on posting pages", () => {
    const { w, root } = setup();
    w.render({ ...base, mode: "posting" });
    expect(root.querySelector("[data-action=run]")).toBeNull();
    expect(root.textContent).toContain("JD saved");
  });
});
```

`tests/extension/one-click.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import {
  isApplicationForm,
  isSubmitControl,
  isPostingPage,
  runOneClick,
} from "../../packages/extension/src/content/content";
import { extractLiveFields } from "../../packages/extension/src/content/extractors/form";
import { normalizeProfile } from "../../packages/extension/src/utils/profile";

const GREENHOUSE_LIKE = `
  <form>
    <label for="first_name">First Name *</label><input id="first_name" required>
    <label for="last_name">Last Name *</label><input id="last_name" required>
    <label for="email">Email *</label><input id="email" type="email" required>
    <label for="phone">Phone</label><input id="phone" type="tel">
    <label for="resume">Resume/CV *</label><input id="resume" type="file" required>
    <label for="q1">Why do you want to work at Acme? *</label><textarea id="q1" required></textarea>
    <label for="q2">Are you legally authorized to work in Canada?</label>
    <select id="q2"><option value="">Select...</option><option>Yes</option><option>No</option></select>
    <button type="submit">Submit application</button>
  </form>`;

function page(html: string): Document {
  const d = document.implementation.createHTMLDocument("t");
  d.body.innerHTML = html;
  return d;
}

describe("gating", () => {
  it("recognizes application forms but not newsletters or logins", () => {
    expect(isApplicationForm(extractLiveFields(page(GREENHOUSE_LIKE)))).toBe(true);
    expect(isApplicationForm(extractLiveFields(page(`<input type="email" placeholder="Email"><button>Subscribe</button>`)))).toBe(false);
    expect(isApplicationForm(extractLiveFields(page(`<input type="email"><input type="password">`)))).toBe(false);
  });
  it("recognizes submit controls but not Next/Apply-for-job links", () => {
    const d = page(`<button id="a">Submit application</button><button id="b">Next</button><button id="c"><span>Submit</span></button><a id="d">Apply for this job</a>`);
    expect(isSubmitControl(d.getElementById("a")!)).toBe(true);
    expect(isSubmitControl(d.getElementById("b")!)).toBe(false);
    expect(isSubmitControl(d.querySelector("#c span")!)).toBe(true);
    expect(isSubmitControl(d.getElementById("d")!)).toBe(false);
  });
  it("treats named boards and JSON-LD postings as posting pages", () => {
    expect(isPostingPage("lever", 0.95)).toBe(true);
    expect(isPostingPage("generic", 0.75)).toBe(true);
    expect(isPostingPage("generic", 0.3)).toBe(false);
    expect(isPostingPage("unknown", 0)).toBe(false);
  });
});

describe("runOneClick", () => {
  it("fills instantly, tailors, attaches the PDF, answers questions, re-applies", async () => {
    const d = page(GREENHOUSE_LIKE);
    const fields = extractLiveFields(d);
    const profile = normalizeProfile({ name: { first: "Jane", last: "Dev" }, email: "j@x.com" });
    const attached: File[] = [];
    Object.defineProperty(d.getElementById("resume"), "files", { set: (v) => attached.push(...v), get: () => attached, configurable: true });
    vi.stubGlobal("DataTransfer", class { list: File[] = []; items = { add: (f: File) => this.list.push(f) }; get files() { return this.list; } });

    const sent: any[] = [];
    let polls = 0;
    const send = async (msg: any) => {
      sent.push(msg);
      switch (msg.type) {
        case "GET_PROFILE": return profile;
        case "TAILOR_START": return { jobId: "J1" };
        case "TAILOR_POLL":
          return ++polls < 2 ? { status: "running" } : {
            status: "done",
            result: {
              applicationId: "a", fileName: "Jane_Dev_Acme.pdf", coverLetter: "Dear", hasCoverLetterPdf: false,
              answers: [{ fieldId: "q1", value: "Because platforms." }, { fieldId: "q2", value: "Yes" }],
              keywords: { injected: [{ keyword: "go", where: "r0.b0" }], skipped: [] },
              edits: [], warnings: [], pages: 1, savedTo: "/x",
            },
          };
        case "FETCH_PDF": return { base64: btoa("%PDF") };
        default: return { ok: true };
      }
    };

    const statuses: string[] = [];
    const report = await runOneClick({
      doc: d, fields, keywords: ["go"], send, pollMs: 1, settleMs: 1,
      jd: { url: "https://acme/jobs/1", title: "SRE", company: "Acme", description: "JD" }, jdSource: "page",
      onStatus: (lines) => statuses.push(lines.map((l) => l.text).join(" | ")),
    });

    expect((d.getElementById("first_name") as HTMLInputElement).value).toBe("Jane");
    expect((d.getElementById("email") as HTMLInputElement).value).toBe("j@x.com");
    expect((d.getElementById("q1") as HTMLTextAreaElement).value).toBe("Because platforms.");
    expect((d.getElementById("q2") as HTMLSelectElement).value).toBe("Yes");
    expect(attached[0].name).toBe("Jane_Dev_Acme.pdf");
    const start = sent.find((m) => m.type === "TAILOR_START");
    expect(start.request.fields.map((f: any) => f.fieldId)).toEqual(["phone", "q1", "q2"]);
    expect(start.request.keywords).toEqual(["go"]);
    expect(report.result?.fileName).toBe("Jane_Dev_Acme.pdf");
    expect(report.needsYou).toEqual([]);
    expect(statuses[0]).toMatch(/filled/);
    expect(sent.some((m) => m.type === "RUN_REPORT")).toBe(true);
    vi.unstubAllGlobals();
  });

  it("keeps the instant fill and reports when the bridge is offline", async () => {
    const d = page(GREENHOUSE_LIKE);
    const report = await runOneClick({
      doc: d, fields: extractLiveFields(d), keywords: [], pollMs: 1, settleMs: 1,
      jd: { url: "u", title: "", company: "", description: "" }, jdSource: "none",
      send: async (msg: any) => (msg.type === "GET_PROFILE" ? normalizeProfile({ email: "j@x.com" }) : { error: "Failed to fetch" }),
      onStatus: () => {},
    });
    expect((d.getElementById("email") as HTMLInputElement).value).toBe("j@x.com");
    expect(report.error).toMatch(/bridge/i);
    expect(report.needsYou).toContain("first_name");
  });
});
```

Update `tests/extension/manifest.test.ts` second test to:

```ts
  it("injects on every site and frame (widget gating happens in the script)", () => {
    const cs = manifest.content_scripts[0];
    expect(cs.matches).toEqual(["<all_urls>"]);
    expect(cs.all_frames).toBe(true);
  });
```

- [ ] **Step 2: Run to verify failure** — `pnpm test:extension -- widget one-click manifest`. Expected: FAIL.

- [ ] **Step 3: Implement `widget.ts`**:

```ts
import type { JDSource } from "../lib/jd-cache";

export interface WidgetState {
  mode: "form" | "posting";
  title: string;
  company: string;
  jdSource: JDSource | string;
  keywords: string[];
  busy: boolean;
  lines: { tone: "ok" | "wait" | "warn" | "err"; text: string }[];
  injected: string[];
  skipped: { keyword: string; reason: string }[];
  collapsed: boolean;
  canOpenPdf: boolean;
}

export interface WidgetHandlers {
  onRun(): void;
  onKeywordsChange(keywords: string[]): void;
  onDismissJD(): void;
  onOpenPdf(): void;
  onDetails(): void;
  onToggle(): void;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const ICON = { ok: "✓", wait: "⏳", warn: "⚠", err: "✗" } as const;
const JD_LABEL: Record<string, string> = {
  override: "pasted", page: "this page", cached: "from posting", recent: "recent", none: "none — using keywords",
};

const CSS = `
:host { all: initial; }
.card { position: fixed; right: 16px; z-index: 2147483647; width: 300px; font: 13px/1.4 system-ui, sans-serif;
  color: #111827; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,.15); padding: 12px; }
.bottom { bottom: 16px; } .top { top: 16px; }
.head { display: flex; justify-content: space-between; align-items: center; font-weight: 600; margin-bottom: 6px; }
.muted { color: #6b7280; font-size: 12px; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
.chip { background: #eef2ff; color: #3730a3; border-radius: 999px; padding: 2px 8px; font-size: 12px; }
.chip button, .x { background: none; border: 0; cursor: pointer; color: inherit; padding: 0 0 0 4px; }
.ok { background: #dcfce7; color: #166534; } .no { background: #f3f4f6; color: #6b7280; }
input { width: 100%; box-sizing: border-box; border: 1px solid #d1d5db; border-radius: 6px; padding: 4px 6px; font: inherit; }
.run { width: 100%; margin: 8px 0 4px; padding: 8px; border: 0; border-radius: 8px; background: #4f46e5; color: #fff;
  font-weight: 600; cursor: pointer; font-size: 14px; }
.run:disabled { background: #a5b4fc; cursor: default; }
.line { margin: 2px 0; } .warn { color: #b45309; } .err { color: #b91c1c; }
.links { display: flex; gap: 10px; margin-top: 6px; }
.links button { background: none; border: 0; color: #4f46e5; cursor: pointer; padding: 0; font: inherit; }
.pill { padding: 6px 10px; }
`;

export function mountWidget(doc: Document, handlers: WidgetHandlers, placement: "bottom" | "top") {
  const host = doc.createElement("div");
  host.setAttribute("data-applymate-widget", "");
  const root = host.attachShadow({ mode: "open" });
  doc.body.appendChild(host);
  let state: WidgetState | null = null;

  const addKeywords = (input: HTMLInputElement) => {
    if (!state) return;
    const fresh = input.value.split(",").map((k) => k.trim()).filter(Boolean);
    input.value = "";
    const next = [...state.keywords];
    for (const k of fresh) if (!next.some((x) => x.toLowerCase() === k.toLowerCase())) next.push(k);
    handlers.onKeywordsChange(next);
  };

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const remove = t.closest("[data-remove]")?.getAttribute("data-remove");
    if (remove !== undefined && remove !== null && state) {
      handlers.onKeywordsChange(state.keywords.filter((k) => k !== remove));
      return;
    }
    const action = t.closest("[data-action]")?.getAttribute("data-action");
    if (action === "run") handlers.onRun();
    else if (action === "dismiss-jd") handlers.onDismissJD();
    else if (action === "pdf") handlers.onOpenPdf();
    else if (action === "details") handlers.onDetails();
    else if (action === "toggle") handlers.onToggle();
  });
  root.addEventListener("keydown", (e) => {
    const t = e.target as HTMLInputElement;
    const key = (e as KeyboardEvent).key;
    if (t.dataset?.role === "kw" && (key === "Enter" || key === ",")) {
      e.preventDefault();
      addKeywords(t);
    }
    e.stopPropagation(); // keep site shortcuts from eating keystrokes
  });

  function render(s: WidgetState): void {
    state = s;
    const kwInput = root.querySelector<HTMLInputElement>("input[data-role=kw]");
    const draft = kwInput?.value ?? "";
    const hadFocus = !!kwInput && root.activeElement === kwInput;
    const job = [s.title, s.company].filter(Boolean).map(escapeHtml).join(" · ") || "Job application";

    if (s.mode === "posting") {
      root.innerHTML = `<style>${CSS}</style><div class="card pill ${placement}">
        <span class="muted">ApplyMate · JD saved ✓ ${escapeHtml(s.title)}</span></div>`;
      return;
    }
    if (s.collapsed) {
      root.innerHTML = `<style>${CSS}</style><div class="card pill ${placement}">
        <button class="x" data-action="toggle">⚡ ApplyMate</button></div>`;
      return;
    }
    const jd = `JD: ${escapeHtml(JD_LABEL[s.jdSource] ?? s.jdSource)}${
      s.jdSource === "recent" ? ` <button class="x" data-action="dismiss-jd" title="Not this job">×</button>` : ""
    }`;
    const chips = s.keywords
      .map((k) => `<span class="chip">${escapeHtml(k)}<button data-remove="${escapeHtml(k)}">×</button></span>`)
      .join("");
    const lines = s.lines
      .map((l) => `<div class="line ${l.tone === "warn" || l.tone === "err" ? l.tone : ""}">${ICON[l.tone]} ${escapeHtml(l.text)}</div>`)
      .join("");
    const report =
      s.injected.length || s.skipped.length
        ? `<div class="chips">${s.injected.map((k) => `<span class="chip ok">✓ ${escapeHtml(k)}</span>`).join("")}${s.skipped
            .map((k) => `<span class="chip no" title="${escapeHtml(k.reason)}">✗ ${escapeHtml(k.keyword)}</span>`)
            .join("")}</div>`
        : "";

    root.innerHTML = `<style>${CSS}</style><div class="card ${placement}">
      <div class="head"><span>⚡ ApplyMate</span><button class="x" data-action="toggle" title="Collapse">–</button></div>
      <div class="muted">${job}</div>
      <div class="muted">${jd}</div>
      <div class="chips">${chips}</div>
      <input data-role="kw" placeholder="Add keywords (Enter)" />
      <button class="run" data-action="run" ${s.busy ? "disabled" : ""}>${s.busy ? "Working…" : "⚡ Autofill & Tailor"}</button>
      ${lines}${report}
      <div class="links">${s.canOpenPdf ? `<button data-action="pdf">Open PDF</button>` : ""}<button data-action="details">Details</button></div>
    </div>`;

    const input = root.querySelector<HTMLInputElement>("input[data-role=kw]")!;
    input.value = draft;
    if (hadFocus) input.focus();
  }

  return { render, host };
}
```

- [ ] **Step 4: Implement `content.ts`** (replace file):

```ts
import { detect } from "./detectors/index";
import { extractJD } from "./extractors/index";
import { extractLiveFields } from "./extractors/form";
import { applyFill, attachFile, findField, highlightEmptyRequired } from "./fill";
import { mountWidget, type WidgetState } from "./widget";
import { sleep } from "./dom";
import { buildInstantPlan } from "../lib/field-mapping";
import { pickJD, rememberJD, type CachedJD, type PageJD } from "../lib/jd-cache";
import type { FormField, Profile, RunReport, TailorResult } from "../types";

export function isApplicationForm(fields: FormField[]): boolean {
  const hasResume = fields.some((f) => f.type === "file" && f.extractedValueType === "resume");
  const hasEmail = fields.some((f) => f.extractedValueType === "email");
  return hasResume || (hasEmail && fields.length >= 4);
}

const SUBMIT_TEXT = /^(submit( my)?( application)?|send application|apply|apply now|finish)$/i;

export function isSubmitControl(el: Element): boolean {
  const btn = el.closest("button, input[type=submit], [role=button]") as HTMLElement | null;
  if (!btn) return false;
  const text = (btn.textContent || (btn as HTMLInputElement).value || "").replace(/\s+/g, " ").trim();
  return SUBMIT_TEXT.test(text);
}

export function isPostingPage(board: string, confidence: number): boolean {
  if (board === "unknown") return false;
  return board !== "generic" || confidence >= 0.75;
}

type Line = WidgetState["lines"][number];
type Send = (msg: unknown) => Promise<any>;

export interface OneClickContext {
  doc: Document;
  fields: FormField[];
  jd: PageJD;
  jdSource: string;
  keywords: string[];
  send: Send;
  onStatus: (lines: Line[]) => void;
  pollMs?: number;
  settleMs?: number;
}

const POLL_LIMIT_MS = 240_000;

function base64ToFile(b64: string, name: string): File {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: "application/pdf" });
}

export async function runOneClick(ctx: OneClickContext): Promise<RunReport> {
  const { doc, fields, send } = ctx;
  const lines: Line[] = [];
  const status = (line: Line, replaceTone?: Line["tone"]) => {
    if (replaceTone) {
      const i = lines.findIndex((l) => l.tone === replaceTone);
      if (i !== -1) lines.splice(i, 1);
    }
    lines.push(line);
    ctx.onStatus([...lines]);
  };

  // Phase 1 — instant fill from the profile.
  const profile = (await send({ type: "GET_PROFILE" })) as Profile;
  const plan = buildInstantPlan(fields, profile);
  const first = await applyFill(plan.instructions, doc);
  status({ tone: "ok", text: `${first.filled.length} fields filled` });

  const report: RunReport = {
    url: ctx.jd.url, title: ctx.jd.title, company: ctx.jd.company, jdSource: ctx.jdSource,
    filled: first.filled.length, needsYou: [], at: Date.now(),
  };

  // Phase 2 — tailor in the background.
  const coverField = fields.find((f) => f.extractedValueType === "cover-letter");
  const start = await send({
    type: "TAILOR_START",
    request: {
      job: { title: ctx.jd.title, company: ctx.jd.company, url: ctx.jd.url, description: ctx.jd.description },
      keywords: ctx.keywords,
      fields: plan.pending
        .filter((f) => f.extractedValueType !== "cover-letter")
        .map((f) => ({ fieldId: f.id, label: f.label, type: f.type, options: f.options, required: f.required })),
      wantCoverLetterPdf: coverField?.type === "file",
    },
  });

  let result: TailorResult | undefined;
  if (!start?.jobId) {
    report.error = `Bridge offline or failed (${start?.error ?? "no response"}) — start it with \`pnpm bridge\``;
    status({ tone: "err", text: report.error });
  } else {
    const began = Date.now();
    for (;;) {
      await sleep(ctx.pollMs ?? 2000);
      const s = await send({ type: "TAILOR_POLL", jobId: start.jobId });
      if (s?.status === "done") {
        result = s.result as TailorResult;
        break;
      }
      if (s?.status === "error" || s?.error || Date.now() - began > POLL_LIMIT_MS) {
        report.error = `Tailoring failed: ${s?.error ?? "timed out"}`;
        status({ tone: "err", text: report.error }, "wait");
        break;
      }
      status({ tone: "wait", text: `Tailoring resume… ${Math.round((Date.now() - began) / 1000)}s` }, "wait");
    }
  }

  if (result) {
    report.result = result;
    const resumeField = fields.find((f) => f.type === "file" && f.extractedValueType === "resume");
    const resumeInput = resumeField ? (findField(doc, resumeField.id) as HTMLInputElement | null) : null;
    let attached = false;
    if (resumeInput) {
      const pdf = await send({ type: "FETCH_PDF", jobId: start.jobId, kind: "resume" });
      if (pdf?.base64) attached = attachFile(resumeInput, base64ToFile(pdf.base64, result.fileName));
    }
    if (coverField?.type === "file" && result.hasCoverLetterPdf) {
      const input = findField(doc, coverField.id) as HTMLInputElement | null;
      const pdf = await send({ type: "FETCH_PDF", jobId: start.jobId, kind: "cover-letter" });
      if (input && pdf?.base64) attachFile(input, base64ToFile(pdf.base64, result.fileName.replace(/\.pdf$/, "_Cover_Letter.pdf")));
    }

    // Resume parsers (Lever, Ashby) overwrite fields on upload — let them
    // finish, then re-apply the profile values and Claude's answers.
    await sleep(ctx.settleMs ?? 1500);
    await applyFill(plan.instructions, doc);
    const answers = [...result.answers];
    if (coverField && coverField.type !== "file" && result.coverLetter) {
      answers.push({ fieldId: coverField.id, value: result.coverLetter });
    }
    const second = await applyFill(answers, doc);

    status(
      {
        tone: "ok",
        text: `${attached ? `PDF attached (${result.pages} page)` : "PDF ready (attach manually)"} · ${second.filled.length} answers drafted`,
      },
      "wait",
    );
    if (result.warnings.length) status({ tone: "warn", text: `${result.warnings.length} things to double-check (Details)` });
  }

  report.needsYou = highlightEmptyRequired(doc, fields);
  if (report.needsYou.length) status({ tone: "warn", text: `${report.needsYou.length} required fields need you` });
  await send({ type: "RUN_REPORT", report });
  return report;
}

// ---------------------------------------------------------------------------
// Live wiring — only inside a real extension context.

const inExtension =
  typeof chrome !== "undefined" && !!chrome.runtime && !!(chrome.runtime as { onMessage?: unknown }).onMessage;

function send(msg: unknown): Promise<any> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        void chrome.runtime.lastError;
        resolve(res ?? { error: "no response" });
      });
    } catch (err) {
      resolve({ error: String(err) });
    }
  });
}

function storageGet<T>(key: string, fallback: T): Promise<T> {
  return new Promise((resolve) => chrome.storage.local.get(key, (r) => resolve((r[key] as T) ?? fallback)));
}
function storageSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set(items, () => resolve()));
}

async function main(): Promise<void> {
  const isTop = window.top === window;
  let widget: ReturnType<typeof mountWidget> | null = null;
  let fields: FormField[] = [];
  let page: PageJD = { url: location.href, title: "", company: "", description: "" };
  let posting = false;
  let ignoreRecent = false;
  let ranFill = false;
  let lastResult: { jobId?: string; result?: TailorResult } = {};
  const ui: WidgetState = {
    mode: "form", title: "", company: "", jdSource: "none", keywords: await storageGet<string[]>("keywords", []),
    busy: false, lines: [], injected: [], skipped: [], collapsed: false, canOpenPdf: false,
  };

  async function currentJD() {
    const cache = await storageGet<Record<string, CachedJD>>("jdCache", {});
    const overrides = await storageGet<Record<string, string>>("jdOverrides", {});
    return pickJD(page, { cache, overrides }, Date.now(), ignoreRecent);
  }

  async function refresh(readJD: boolean): Promise<void> {
    if (readJD) {
      const html = document.documentElement.outerHTML;
      const detection = detect({ url: location.href, html });
      posting = isTop && isPostingPage(detection.board, detection.confidence);
      const extracted = posting ? extractJD(html, detection.board) : { jobTitle: document.title, company: "", jobDescription: "" };
      page = { url: location.href, title: extracted.jobTitle, company: extracted.company, description: extracted.jobDescription };
      if (posting && page.description.length >= 200) {
        const cache = await storageGet<Record<string, CachedJD>>("jdCache", {});
        await storageSet({ jdCache: rememberJD(cache, page, Date.now()) });
      }
    }
    fields = extractLiveFields(document);
    const isForm = isApplicationForm(fields);
    if (!isForm && !posting) return;
    const { jd, source } = await currentJD();
    Object.assign(ui, { mode: isForm ? "form" : "posting", title: jd.title, company: jd.company, jdSource: source });
    widget ??= mountWidget(document, handlers, isTop ? "bottom" : "top");
    widget.render(ui);
  }

  const handlers = {
    onRun: async () => {
      if (ui.busy) return;
      Object.assign(ui, { busy: true, lines: [], injected: [], skipped: [], canOpenPdf: false });
      widget?.render(ui);
      fields = extractLiveFields(document);
      const { jd, source } = await currentJD();
      ranFill = true;
      const report = await runOneClick({
        doc: document, fields, jd, jdSource: source, keywords: ui.keywords,
        send: async (msg: any) => {
          const res = await send(msg);
          if (msg?.type === "TAILOR_START" && res?.jobId) lastResult.jobId = res.jobId;
          return res;
        },
        onStatus: (lines) => {
          ui.lines = lines;
          widget?.render(ui);
        },
      });
      lastResult.result = report.result;
      Object.assign(ui, {
        busy: false,
        canOpenPdf: !!report.result,
        injected: report.result?.keywords.injected.map((k) => k.keyword) ?? [],
        skipped: report.result?.keywords.skipped ?? [],
      });
      widget?.render(ui);
    },
    onKeywordsChange: async (keywords: string[]) => {
      ui.keywords = keywords;
      await storageSet({ keywords });
      widget?.render(ui);
    },
    onDismissJD: async () => {
      ignoreRecent = true;
      await refresh(false);
    },
    onOpenPdf: async () => {
      if (!lastResult.jobId) return;
      const pdf = await send({ type: "FETCH_PDF", jobId: lastResult.jobId, kind: "resume" });
      if (pdf?.base64) window.open(URL.createObjectURL(base64ToFile(pdf.base64, lastResult.result?.fileName ?? "resume.pdf")));
    },
    onDetails: () => void send({ type: "OPEN_SIDE_PANEL" }),
    onToggle: () => {
      ui.collapsed = !ui.collapsed;
      widget?.render(ui);
    },
  };

  // The user's own submit click marks the application applied (never ours).
  document.addEventListener(
    "click",
    (e) => {
      if (!ranFill || !(e.target instanceof Element) || !isSubmitControl(e.target)) return;
      ranFill = false;
      void send({ type: "MARK_APPLIED", jobUrl: page.url, company: ui.company, jobTitle: ui.title });
    },
    true,
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastUrl = location.href;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const moved = location.href !== lastUrl;
      lastUrl = location.href;
      void refresh(moved);
    }, 500);
  }).observe(document.body, { childList: true, subtree: true });

  await refresh(true);
}

if (inExtension && typeof document !== "undefined" && document.body) {
  void main();
}
```

- [ ] **Step 5: IIFE content build** — create `packages/extension/vite.content.config.ts`:

```ts
import { defineConfig } from "vite";
import path from "path";

// Content scripts are classic scripts: one self-contained IIFE, no imports.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, "src/content/content.ts"),
      formats: ["iife"],
      name: "ApplyMateContent",
      fileName: () => "content.js",
    },
  },
});
```

In `packages/extension/vite.config.ts` remove the `content:` entry from `rollupOptions.input`. In `packages/extension/package.json` set `"build": "vite build && vite build -c vite.content.config.ts"` and remove the unused `uuid`/`@types/uuid` deps (`pnpm --filter @applymate/extension remove uuid @types/uuid`).

Manifest `content_scripts`:

```json
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "all_frames": true,
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ],
```

- [ ] **Step 6: Run tests** — `pnpm test:extension`. Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add -A packages/extension tests/extension pnpm-lock.yaml
git commit -m "feat: one-click widget — instant fill, background tailoring, PDF attach, submit tracking"
```

---

### Task 13: slim side panel + dead code removal + build verification

**Files:**
- Rewrite: `packages/extension/src/ui/side-panel.tsx`
- Delete: `packages/extension/src/ui/components/{JobDataReview,FormValidation,TailoringReview,FormAutoFill,KeywordGap,ManualEntry,ProfileEditor}.tsx`, `packages/extension/src/lib/manual-prompt.ts`, `packages/extension/src/utils/storage.ts`, `packages/extension/src/utils/messaging.ts`
- Keep: `BridgeStatus.tsx`, `BridgeTokenField.tsx`

**Interfaces:**
- Consumes: `RunReport` (session storage `lastRun:<tabId>`), `jobKey`, `jdOverrides` in local storage.

- [ ] **Step 1: Implement side panel** (replace file):

```tsx
import { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import "./styles/tailwind.css";
import { BridgeStatus } from "./components/BridgeStatus";
import { BridgeTokenField } from "./components/BridgeTokenField";
import { jobKey } from "../lib/jd-cache";
import type { RunReport } from "../types";

function useActiveTab() {
  const [tab, setTab] = useState<chrome.tabs.Tab | null>(null);
  useEffect(() => {
    const load = () => chrome.tabs.query({ active: true, currentWindow: true }, ([t]) => setTab(t ?? null));
    load();
    chrome.tabs.onActivated.addListener(load);
    chrome.tabs.onUpdated.addListener(load);
    return () => {
      chrome.tabs.onActivated.removeListener(load);
      chrome.tabs.onUpdated.removeListener(load);
    };
  }, []);
  return tab;
}

function App() {
  const tab = useActiveTab();
  const [report, setReport] = useState<RunReport | null>(null);
  const [jd, setJd] = useState("");
  const [saved, setSaved] = useState(false);
  const key = tab?.url ? jobKey(tab.url) : "";

  useEffect(() => {
    if (tab?.id === undefined) return;
    const storageKey = `lastRun:${tab.id}`;
    chrome.storage.session.get(storageKey, (r) => setReport((r[storageKey] as RunReport) ?? null));
    const onChange = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes[storageKey]) setReport(changes[storageKey].newValue as RunReport);
    };
    chrome.storage.session.onChanged.addListener(onChange);
    return () => chrome.storage.session.onChanged.removeListener(onChange);
  }, [tab?.id]);

  useEffect(() => {
    chrome.storage.local.get("jdOverrides", (r) => setJd(((r.jdOverrides ?? {}) as Record<string, string>)[key] ?? ""));
    setSaved(false);
  }, [key]);

  async function saveJd(text: string) {
    const r = await chrome.storage.local.get("jdOverrides");
    const overrides = { ...((r.jdOverrides ?? {}) as Record<string, string>) };
    if (text.trim()) overrides[key] = text.trim();
    else delete overrides[key];
    await chrome.storage.local.set({ jdOverrides: overrides });
    setSaved(true);
  }

  const res = report?.result;
  return (
    <div className="p-3 space-y-4 text-sm bg-white min-h-screen">
      <div className="flex items-center justify-between">
        <h1 className="font-bold text-base">⚡ ApplyMate</h1>
        <BridgeStatus />
      </div>

      {!report && <p className="text-gray-500 text-xs">Click ⚡ Autofill &amp; Tailor on an application page. The run's details show up here.</p>}

      {report && (
        <section className="space-y-2">
          <h2 className="font-semibold">{[report.title, report.company].filter(Boolean).join(" · ") || "Last run"}</h2>
          <p className="text-xs text-gray-600">
            JD: {report.jdSource} · {report.filled} fields filled instantly
            {report.needsYou.length ? ` · ${report.needsYou.length} required fields need you` : ""}
          </p>
          {report.error && <p className="text-xs text-red-700">{report.error}</p>}
          {res && (
            <>
              <p className="text-xs">📄 {res.fileName} · {res.pages} page · saved to <code>{res.savedTo}</code></p>
              <div className="flex flex-wrap gap-1">
                {res.keywords.injected.map((k) => (
                  <span key={k.keyword} className="bg-green-100 text-green-800 rounded px-1.5 text-xs" title={k.where}>✓ {k.keyword}</span>
                ))}
                {res.keywords.skipped.map((k) => (
                  <span key={k.keyword} className="bg-gray-100 text-gray-600 rounded px-1.5 text-xs" title={k.reason}>✗ {k.keyword}</span>
                ))}
              </div>
              {res.warnings.length > 0 && (
                <ul className="text-xs text-amber-700 list-disc ml-4">{res.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              )}
              <details>
                <summary className="cursor-pointer text-xs font-medium">Bullet changes ({res.edits.length})</summary>
                {res.edits.map((e) => (
                  <div key={e.id} className="border rounded p-2 my-1 text-xs space-y-1">
                    <div className="text-gray-400">{e.id}{e.reverted ? ` — reverted: ${e.reverted}` : ""}</div>
                    <div className="line-through text-gray-400">{e.before}</div>
                    <div>{e.after}</div>
                  </div>
                ))}
              </details>
              <details>
                <summary className="cursor-pointer text-xs font-medium">Cover letter</summary>
                <textarea readOnly value={res.coverLetter} className="w-full border rounded p-1 h-40 text-xs" />
              </details>
            </>
          )}
        </section>
      )}

      <section className="space-y-1">
        <h2 className="font-semibold text-xs">Paste JD for this page</h2>
        <p className="text-xs text-gray-500">Overrides the auto-detected JD for this job.</p>
        <textarea value={jd} onChange={(e) => { setJd(e.target.value); setSaved(false); }} className="w-full border rounded p-1 h-24 text-xs" placeholder="Paste the job description…" />
        <button onClick={() => void saveJd(jd)} disabled={!key} className="bg-gray-800 text-white rounded px-2 py-1 text-xs">
          {saved ? "Saved ✓" : "Save JD"}
        </button>
      </section>

      <details>
        <summary className="cursor-pointer text-xs text-gray-500">Bridge pairing (automatic; manual fallback)</summary>
        <BridgeTokenField />
      </details>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("app") || document.body).render(<App />);
```

Update `BridgeTokenField.tsx` copy: replace the `<p>` text with `Pairing is automatic. Only paste the token (~/.applymate/bridge-token) if auto-pairing fails.`

- [ ] **Step 2: Delete dead code**

```bash
git rm packages/extension/src/ui/components/{JobDataReview,FormValidation,TailoringReview,FormAutoFill,KeywordGap,ManualEntry,ProfileEditor}.tsx packages/extension/src/lib/manual-prompt.ts packages/extension/src/utils/storage.ts packages/extension/src/utils/messaging.ts
grep -rn "manual-prompt\|utils/storage\|utils/messaging\|fetchLatestOutput\|fetchResumeKeywords\|ExtractedJobData" packages/extension/src
```

Expected: grep finds nothing except the `ExtractedJobData` re-export in `types.ts` (remove it from the re-export list if unused).

- [ ] **Step 3: Full verification**

Run each; all must pass:
```bash
pnpm type-check && pnpm type-check:bridge && pnpm type-check:skill
pnpm test && pnpm test:skill && pnpm test:bridge
pnpm --filter @applymate/dashboard exec vitest run
pnpm build:extension
grep -c '^import\|^export' packages/extension/dist/content.js   # expect 0
ls packages/extension/dist   # background.js content.js manifest.json side-panel.html side-panel.js …
```

- [ ] **Step 4: Commit**

```bash
git add -A packages/extension
git commit -m "refactor: slim side panel to run details, pairing, paste-JD; remove wizard + manual prompt flow"
```

---

### Task 14: live verification with Claude in Chrome

**Files:**
- Create: `tests/fixtures/pages/greenhouse.html`, `tests/fixtures/pages/lever-apply.html`, `tests/fixtures/pages/lever-posting.html`, `tests/fixtures/pages/embed.html`
- Modify: whatever the live runs prove wrong (with a regression test per fix), `lib/shared/constants.ts` `BOARD_COVERAGE.lastVerified`

- [ ] **Step 1: Bring the stack up**

```bash
pnpm profile:init          # then fill phone/address/work_auth in ~/.applymate/profile.yaml with the user
pnpm bridge:install        # launchd agent (stop any manually started bridge first: lsof -i :4179)
curl -s http://127.0.0.1:4179/health    # {"ok":true}
pnpm build:extension
```

Ask the user to load/reload `packages/extension/dist` at `chrome://extensions` (Developer mode → Load unpacked / ↻). Claude in Chrome can't drive the native file picker.

- [ ] **Step 2: Local fixture pages** — write fixture pages that mimic the real DOM shapes: Greenhouse (label[for], react-select-style combobox for Gender with `role=option` menu rendered on ArrowDown, file input that renders the chosen filename into a `<span id="resume-name">` on `change`, a required custom textarea, EEO select), Lever posting + `/apply` pair (JD only on the posting; `.application-label` questions; radio group), and `embed.html` (JSON-LD JobPosting on the parent + an iframe to `greenhouse.html`). Serve them: `python3 -m http.server 8765 --bind 127.0.0.1 --directory tests/fixtures/pages` (background).

- [ ] **Step 3: Drive them with Claude in Chrome** (invoke the `claude-in-chrome` skill first; load tools in one ToolSearch). For each fixture: open tab → confirm widget renders → click ⚡ → wait up to 120s → read DOM via `javascript_tool` (input values, `#resume-name` text, gender hidden value, textarea contents) → screenshot. Lever: visit posting first, then `/apply` → widget must say `JD: from posting`. Embed: widget inside the iframe with `JD: recent`. Record a GIF (`one_click_fixture.gif`). **Never click Submit.**

Expected: instant fill < 1s; PDF filename shown within ~90s; custom questions answered; side panel "Details" shows injected/skipped keywords.

- [ ] **Step 4: Real postings** — ask the user for 1 Greenhouse, 1 Lever, 1 Ashby posting they'd actually apply to (attaching uploads the PDF to that ATS even without submitting). Run the same flow on each. Fix every extraction/fill miss with a regression test using the observed DOM snippet. **Never click Submit.** Record `one_click_live.gif`.

- [ ] **Step 5: Update coverage + commit**

Set `BOARD_COVERAGE.<board>.lastVerified` to today's date for boards verified live.

```bash
git add -A tests/fixtures lib/shared/constants.ts packages
git commit -m "test: live-verified one-click flow on Greenhouse/Lever/Ashby; fixes from live runs"
```

---

### Task 15: docs

**Files:**
- Modify: `CLAUDE.md`, `README.md` (quick start section only), `HANDOFF.md` (replace with the new state)

- [ ] **Step 1: Update CLAUDE.md** — replace "System Architecture", "Message Flow", "The 5-Stage Pipeline" sections with the one-click flow (content widget → background proxy → bridge `/tailor` job → `claude -p` → resume-doc splice → checks → tectonic compat → page fit → persist → PDF attach), list the new commands (`pnpm bridge:install`, `pnpm bridge:unpair`, `pnpm profile:init`, `pnpm tailor:smoke`), the `~/.applymate/` files (`profile.yaml`, `paired-extension`, `applications/<date>-<co>-<role>/`), and the constraints from this plan's Global Constraints. Note the old manual/pgvector code is slated for deletion pending user OK.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md README.md HANDOFF.md
git commit -m "docs: document one-click flow, commands, and local files"
```

- [ ] **Step 3: Ask the user** before deleting the unused legacy code listed in the spec's "Cleanup after verification" (retrieve/pgvector/embeddings/docker/manual CLI/apply-to-job skill/assemble-latex marker path and their tests). Delete only on their OK, in its own commit (move `escapeLatex` into `tailor/letter.ts` first).
