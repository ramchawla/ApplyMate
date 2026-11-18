import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeChat, writeRun } from "../../../lib/local/runs";
import { parseResume, partLabels } from "../../skill/src/tailor/resume-doc";
import type { RunFile, RunState } from "../../../lib/shared/types";

vi.mock("server-only", () => ({}));

const masterTex = readFileSync(
  fileURLToPath(new URL("../../../tests/skill/fixtures/resume-master.tex", import.meta.url)),
  "utf8",
);
const doc = parseResume(masterTex);
const summary = doc.parts.find((p) => p.id === "summary")!.text;

const report = (runId: string, createdAt: string): RunFile => ({
  applicationId: "app_1",
  runId,
  createdAt,
  job: { title: "SRE", company: "Acme", url: "https://x/1" },
  fileName: "Jane_Dev_Acme_SRE.pdf",
  wantCoverLetterPdf: false,
  labels: partLabels(doc),
  questions: [],
  keywords: { present: [{ keyword: "Go", where: "summary" }], injected: [], skipped: [] },
  edits: [{ id: "summary", before: summary, after: "Reliability engineer." }],
  warnings: [],
  pages: 1,
});
const state: RunState = {
  edits: { summary: "Reliability engineer." },
  order: {},
  coverLetter: "Dear Acme,",
  answers: {},
  questions: [],
  version: 0,
};

const prevDir = process.env.APPLYMATE_DIR;
let apps: string;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "am-dash-"));
  process.env.APPLYMATE_DIR = dir;
  apps = join(dir, "applications");
  const write = (name: string, runId: string, at: string) =>
    writeRun(join(apps, name), {
      report: report(runId, at),
      state,
      masterTex,
      resumeTex: masterTex,
      resumePdf: Buffer.from("%PDF"),
      coverLetter: state.coverLetter,
      jd: "JD",
    });
  await write("2026-11-13-acme-sre", "run-old", "2026-11-13T10:18:00.000Z");
  await write("2026-11-13-acme-sre-2", "run-new", "2026-11-13T10:42:00.000Z");
  writeChat(join(apps, "2026-11-13-acme-sre-2"), [{ role: "user", text: "Shorter summary", at: 1 }]);
  // Corrupt state.json: skipped, not thrown.
  await write("2026-11-13-acme-sre-3", "run-bad", "2026-11-13T11:00:00.000Z");
  writeFileSync(join(apps, "2026-11-13-acme-sre-3", "state.json"), "{not json");
  // Malformed report.json (runId but no createdAt): skipped, can't be sorted.
  mkdirSync(join(apps, "2026-11-13-acme-sre-4"));
  writeFileSync(join(apps, "2026-11-13-acme-sre-4", "report.json"), JSON.stringify({ applicationId: "app_1", runId: "run-x" }));
  // Legacy folder: report.json without runId.
  mkdirSync(join(apps, "2026-09-28-acme-sre"));
  writeFileSync(join(apps, "2026-09-28-acme-sre", "report.json"), JSON.stringify({ applicationId: "app_1" }));
});

afterAll(() => {
  if (prevDir === undefined) delete process.env.APPLYMATE_DIR;
  else process.env.APPLYMATE_DIR = prevDir;
});

describe("getRuns", () => {
  it("returns runs newest first with views built; legacy and unreadable runs skipped", async () => {
    const { getRuns } = await import("../lib/data");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const runs = getRuns("app_1");
    expect(runs.map((r) => r.runId)).toEqual(["run-new", "run-old"]);
    expect(runs[0].createdAt).toBe("2026-11-13T10:42:00.000Z");
    expect(runs[0].view).toMatchObject({ title: "SRE", company: "Acme", coverage: { covered: 1, total: 1 } });
    expect(runs[0].view.changes).toEqual([
      expect.objectContaining({ id: "summary", label: "Summary", after: "Reliability engineer." }),
    ]);
    expect(runs[0].chat).toEqual([{ role: "user", text: "Shorter summary", at: 1 }]);
    expect(runs[1].chat).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(getRuns("app_other")).toEqual([]);
    errors.mockRestore();
  });
});

describe("runVersions / untaggedVersions", () => {
  it("groups version rows by run, newest first; rows without a runId are earlier versions", async () => {
    const { runVersions, untaggedVersions } = await import("../lib/data");
    const rows = [
      { id: "legacy", report: { perBullet: [] } },
      { id: "old-v0", report: { runId: "run-old", version: 0 } },
      { id: "new-v0", report: { runId: "run-new", version: 0 } },
      { id: "new-v2", report: { runId: "run-new", version: 2, label: "Summary" } },
      { id: "new-v1", report: { runId: "run-new", version: 1, label: "Undo: Summary" } },
    ];
    expect(runVersions(rows, "run-new").map((r) => r.id)).toEqual(["new-v2", "new-v1", "new-v0"]);
    expect(runVersions(rows, "run-old").map((r) => r.id)).toEqual(["old-v0"]);
    expect(untaggedVersions(rows).map((r) => r.id)).toEqual(["legacy"]);
  });
});
