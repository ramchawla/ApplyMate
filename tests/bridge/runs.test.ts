import { describe, it, expect } from "vitest";
import { existsSync, linkSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  uniqueRunDir,
  writeRun,
  readRun,
  writeState,
  writeChat,
  scanRuns,
  runsForApplication,
} from "../../lib/local/runs";
import type { RunFile, RunState } from "../../lib/shared/types";

const tmpApps = () => mkdtempSync(join(tmpdir(), "am-apps-"));

function report(over: Partial<RunFile> = {}): RunFile {
  return {
    applicationId: "app_1",
    runId: "run-a",
    createdAt: "2026-11-16T10:00:00.000Z",
    job: { title: "SRE", company: "Acme", url: "https://x/1" },
    fileName: "Jane_Dev_Acme_SRE.pdf",
    wantCoverLetterPdf: false,
    labels: { summary: "Summary" },
    questions: [{ fieldId: "q", label: "Why us?", type: "textarea", required: true }],
    keywords: { present: [], injected: [], skipped: [] },
    edits: [{ id: "summary", before: "a", after: "b" }],
    warnings: [],
    pages: 1,
    ...over,
  };
}
const state: RunState = {
  edits: { summary: "b" },
  order: {},
  coverLetter: "Dear",
  answers: { q: "A" },
  questions: report().questions,
  version: 0,
};
const files = (r: RunFile) => ({
  report: r,
  state,
  masterTex: "\\master",
  resumeTex: "\\tex",
  resumePdf: Buffer.from("%PDF"),
  coverLetter: "Dear",
  jd: "JD",
});

describe("run folders", () => {
  it("suffixes a same-day rerun instead of overwriting", () => {
    const apps = tmpApps();
    expect(uniqueRunDir(apps, "2026-11-16-acme-sre")).toBe(join(apps, "2026-11-16-acme-sre"));
    mkdirSync(join(apps, "2026-11-16-acme-sre"));
    expect(uniqueRunDir(apps, "2026-11-16-acme-sre")).toBe(join(apps, "2026-11-16-acme-sre-2"));
    mkdirSync(join(apps, "2026-11-16-acme-sre-2"));
    expect(uniqueRunDir(apps, "2026-11-16-acme-sre")).toBe(join(apps, "2026-11-16-acme-sre-3"));
  });

  it("round-trips a run and indexes it by runId and applicationId", async () => {
    const apps = tmpApps();
    const older = join(apps, "older");
    const newer = join(apps, "newer");
    await writeRun(older, files(report()));
    await writeRun(newer, files(report({ runId: "run-b", createdAt: "2026-11-16T11:00:00.000Z" })));
    await writeRun(join(apps, "other"), files(report({ runId: "run-c", applicationId: "app_2" })));

    expect(readRun(older)).toEqual({ report: report(), state, chat: [], masterTex: "\\master" });

    const next = { ...state, version: 1, coverLetter: "Hi" };
    const chat = [{ role: "user" as const, text: "shorter", at: 1 }];
    writeState(older, next);
    writeChat(older, chat);
    expect(readRun(older).state).toEqual(next);
    expect(readRun(older).chat).toEqual(chat);

    const index = scanRuns(apps);
    expect(index.get("run-a")).toBe(older);
    expect(index.get("run-b")).toBe(newer);
    expect(runsForApplication(apps, "app_1").map((r) => r.dir)).toEqual([newer, older]);
    expect(runsForApplication(apps, "app_1")[0].report.runId).toBe("run-b");
  });

  it("skips legacy folders without a runId", () => {
    const apps = tmpApps();
    mkdirSync(join(apps, "legacy"));
    writeFileSync(join(apps, "legacy", "report.json"), "{}");
    mkdirSync(join(apps, "empty"));
    expect(scanRuns(apps).size).toBe(0);
    expect(runsForApplication(apps, "app_1")).toEqual([]);
    expect(scanRuns(join(apps, "missing")).size).toBe(0);
  });
});

describe("run writes", () => {
  it("state.json and chat.json are replaced by rename, never rewritten in place", async () => {
    const dir = join(tmpApps(), "run");
    await writeRun(dir, files(report()));
    writeChat(dir, []);
    // A hard link shares the inode: an in-place write would change it too.
    linkSync(join(dir, "state.json"), join(dir, "state-link.json"));
    linkSync(join(dir, "chat.json"), join(dir, "chat-link.json"));
    writeState(dir, { ...state, version: 7 });
    writeChat(dir, [{ role: "user", text: "hi", at: 1 }]);
    expect(readRun(dir).state.version).toBe(7);
    expect(readRun(dir).chat).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(dir, "state-link.json"), "utf8")).version).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "chat-link.json"), "utf8"))).toEqual([]);
    expect(readdirSync(dir).filter((f) => f.includes(".tmp"))).toEqual([]);
  });

  it("writes the v0 cover-letter.pdf when tailoring made one", async () => {
    const apps = tmpApps();
    await writeRun(join(apps, "a"), { ...files(report()), coverLetterPdf: Buffer.from("%PDF-letter") });
    expect(readFileSync(join(apps, "a", "cover-letter.pdf"), "utf8")).toBe("%PDF-letter");
    await writeRun(join(apps, "b"), files(report()));
    expect(existsSync(join(apps, "b", "cover-letter.pdf"))).toBe(false);
  });
});
