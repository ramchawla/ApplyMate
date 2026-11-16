import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTailorJob, resumeFileName } from "../../packages/bridge/src/tailor-job";
import { readRun } from "../../lib/local/runs";
import { parseResume, renderResume } from "../../packages/skill/src/tailor/resume-doc";

const FIXTURE = fileURLToPath(
  new URL("../skill/fixtures/resume-master.tex", import.meta.url),
);

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
        keywords: { present: [], injected: [], skipped: [{ keyword: "rust", reason: "none" }] },
        coverLetter: "Dear Hiring Team,",
        answers: [{ fieldId: "q", value: "A" }],
      }),
    });
    const out = await job({
      job: { title: "Platform Eng", company: "Acme", url: "https://x/1", description: "JD text" },
      keywords: ["rust"],
      fields: [{ fieldId: "q", label: "Why us?", type: "textarea", required: true }],
      wantCoverLetterPdf: false,
    });
    expect(out.result.fileName).toBe("Jane_Dev_Acme_Platform_Eng.pdf");
    expect(out.result.answers).toEqual([{ fieldId: "q", value: "A" }]);
    expect(out.result.hasCoverLetterPdf).toBe(false);
    expect(out.result.savedTo).toBe(
      join(dir, "applications", "2026-09-28-acme-platform-eng"),
    );
    expect(readFileSync(join(out.result.savedTo, "jd.md"), "utf8")).toBe("JD text");
    expect(existsSync(join(out.result.savedTo, "resume.pdf"))).toBe(true);
    expect(existsSync(join(out.result.savedTo, "master.tex"))).toBe(true);
    const run = readRun(out.result.savedTo);
    expect(run.state.version).toBe(0);
    expect(run.state.answers).toEqual({ q: "A" });
    expect(run.state.questions[0].label).toBe("Why us?");
    expect(run.report.runId).toBe(out.result.runId);
    expect(run.report.applicationId).toBe(out.result.applicationId);
    expect(run.report.createdAt).toBe("2026-09-28T10:00:00.000Z");
    expect(out.result.runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(out.result.labels["summary"]).toBe("Summary");
    expect(out.result.version).toBe(0);
  });

  it("suffixes a same-day rerun of the same job", async () => {
    const dir = appDir();
    const job = makeTailorJob({
      dir,
      now: () => new Date("2026-09-28T10:00:00Z"),
      compile: async (latex) => ({ pdf: Buffer.from(latex.slice(0, 5)), pages: 1 }),
      runner: async () => ({}),
    });
    const req = {
      job: { title: "SRE", company: "Acme", url: "https://x/1", description: "" },
      keywords: [],
      fields: [],
      wantCoverLetterPdf: false,
    };
    const a = await job(req);
    const b = await job(req);
    expect(b.result.savedTo).toBe(`${a.result.savedTo}-2`);
    expect(b.result.runId).not.toBe(a.result.runId);
  });

  it("renders from the snapshot after the master changes", async () => {
    const dir = appDir();
    const doc = parseResume(readFileSync(FIXTURE, "utf8"));
    const [first, second] = doc.groups[0].bulletIds;
    const job = makeTailorJob({
      dir,
      compile: async (latex) => ({ pdf: Buffer.from(latex.slice(0, 5)), pages: 1 }),
      runner: async () => ({
        edits: [{ id: first, latex: "Edited bullet" }],
        order: [{ role: doc.groups[0].id, ids: [...doc.groups[0].bulletIds].reverse() }],
      }),
    });
    const out = await job({
      job: { title: "SRE", company: "Acme", url: "https://x/3", description: "" },
      keywords: [],
      fields: [],
      wantCoverLetterPdf: false,
    });
    expect(second).toBeDefined();
    const live = join(dir, "resume-master.tex");
    writeFileSync(
      live,
      readFileSync(live, "utf8").replace("\\resumeItem{Built", "\\resumeItem{New first bullet}\n        \\resumeItem{Built"),
    );
    const { masterTex, state } = readRun(out.result.savedTo);
    expect(state.edits).toEqual({ [first]: "Edited bullet" });
    expect(renderResume(parseResume(masterTex), state.edits, state.order)).toBe(
      readFileSync(join(out.result.savedTo, "resume.tex"), "utf8"),
    );
    expect(readFileSync(live, "utf8")).toContain("New first bullet");
    expect(masterTex).not.toContain("New first bullet");
  });

  it("names files from the JD's own title when the page scraped a heading", async () => {
    const dir = appDir();
    const job = makeTailorJob({
      dir,
      now: () => new Date("2026-11-16T10:00:00Z"),
      compile: async (latex) => ({ pdf: Buffer.from(latex.slice(0, 5)), pages: 1 }),
      runner: async () => ({
        job: { title: "Staff AI Engineer", company: "BSC Analytics" },
        edits: [],
        order: [],
        keywords: { present: [], injected: [], skipped: [] },
        coverLetter: "",
        answers: [],
      }),
    });
    const out = await job({
      job: { title: "Key Responsibilities", company: "company", url: "https://x/2", description: "JD" },
      keywords: [],
      fields: [],
      wantCoverLetterPdf: false,
    });
    expect(out.result.fileName).toBe("Jane_Dev_BSC_Analytics_Staff_AI_Engineer.pdf");
    expect(out.result.savedTo).toBe(
      join(dir, "applications", "2026-11-16-bsc-analytics-staff-ai-engineer"),
    );
  });

  it("fails clearly when the master resume is missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "am-empty-"));
    const job = makeTailorJob({
      dir,
      runner: async () => ({}),
      compile: async () => ({ pdf: Buffer.from(""), pages: 1 }),
    });
    await expect(
      job({
        job: { title: "", company: "", url: "u", description: "" },
        keywords: [],
        fields: [],
        wantCoverLetterPdf: false,
      }),
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
