// Shared by the route tests: a real run folder on disk plus a chat with two proposals.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeChat, writeRun } from "../../lib/local/runs";
import { parseResume, partLabels } from "../../packages/skill/src/tailor/resume-doc";
import type { RunState, TailorQuestion } from "../../lib/shared/types";

const masterTex = readFileSync(
  fileURLToPath(new URL("../skill/fixtures/resume-master.tex", import.meta.url)),
  "utf8",
);
const doc = parseResume(masterTex);
export const summaryBefore = doc.parts.find((p) => p.id === "summary")!.text;
export const SUMMARY_AFTER = "Reliability engineer who ships.";
export const LETTER_AFTER = "Dear team, new letter.";

export const fakeCompile = async (tex: string) => ({
  pdf: Buffer.from(`%PDF-new-${tex.length}`),
  pages: 1,
  height: 700,
  goal: 0,
});

export async function setupRun(runId: string, questions: TailorQuestion[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "am-t7-"));
  const appsDir = join(dir, "applications");
  const runDir = join(appsDir, `2026-11-16-${runId}`);
  const state: RunState = {
    edits: {},
    order: {},
    coverLetter: "Dear, old.",
    answers: {},
    questions,
    version: 0,
  };
  await writeRun(runDir, {
    report: {
      applicationId: "app_1",
      runId,
      createdAt: "2026-11-16T10:00:00.000Z",
      job: { title: "SRE", company: "Acme", url: "https://x/1" },
      fileName: "Jane_Dev_Acme_SRE.pdf",
      wantCoverLetterPdf: false,
      labels: partLabels(doc),
      questions,
      keywords: { present: [], injected: [], skipped: [] },
      edits: [],
      warnings: [],
      pages: 1,
    },
    state,
    masterTex,
    resumeTex: masterTex,
    resumePdf: Buffer.from("%PDF-orig"),
    coverLetter: state.coverLetter,
    jd: "JD",
  });
  writeChat(runDir, [
    {
      role: "assistant",
      text: "ok",
      at: 1,
      proposals: [
        { target: "summary", label: "Summary", before: summaryBefore, after: SUMMARY_AFTER, why: "x", warnings: [] },
        { target: "cover-letter", label: "Cover letter", before: state.coverLetter, after: LETTER_AFTER, why: "x", warnings: [] },
      ],
    },
  ]);
  return { dir, appsDir, runDir };
}

// What a finished tailor job returns for a run made by setupRun.
export const tailorOutput = (runId: string, questions: TailorQuestion[] = []) => ({
  result: {
    applicationId: "app_1",
    fileName: "Jane_Dev.pdf",
    coverLetter: "Dear, old.",
    hasCoverLetterPdf: false,
    answers: [],
    keywords: { present: [], injected: [], skipped: [] },
    edits: [],
    warnings: [],
    pages: 1,
    savedTo: "/tmp/x",
    runId,
    labels: {},
    questions,
    version: 0,
  },
  resumePdf: Buffer.from("%PDF-resume"),
  coverLetterPdf: Buffer.from("%PDF-letter"),
});
