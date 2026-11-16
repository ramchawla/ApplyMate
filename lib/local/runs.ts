// One tailoring run = one folder under ~/.applymate/applications/. The folder
// is self-describing (report.json carries runId/applicationId), so the bridge
// after a restart and the dashboard find runs by scanning, no extra index.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChatMessage, RunFile, RunState } from "../shared/types";

export function uniqueRunDir(appsDir: string, base: string): string {
  let dir = join(appsDir, base);
  for (let n = 2; existsSync(dir); n++) dir = join(appsDir, `${base}-${n}`);
  return dir;
}

export async function writeRun(
  dir: string,
  f: {
    report: RunFile;
    state: RunState;
    masterTex: string;
    resumeTex: string;
    resumePdf: Buffer;
    coverLetter: string;
    jd: string;
  },
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(join(dir, "master.tex"), f.masterTex, "utf8"),
    writeFile(join(dir, "state.json"), JSON.stringify(f.state, null, 2), "utf8"),
    writeFile(join(dir, "resume.tex"), f.resumeTex, "utf8"),
    writeFile(join(dir, "resume.pdf"), f.resumePdf),
    writeFile(join(dir, "cover-letter.md"), f.coverLetter, "utf8"),
    writeFile(join(dir, "jd.md"), f.jd, "utf8"),
  ]);
  // Last: report.json is what indexes a run, so a half-written folder is never found.
  await writeFile(join(dir, "report.json"), JSON.stringify(f.report, null, 2), "utf8");
}

const readJson = (dir: string, file: string) =>
  JSON.parse(readFileSync(join(dir, file), "utf8"));

export function readRun(dir: string): {
  report: RunFile;
  state: RunState;
  chat: ChatMessage[];
  masterTex: string;
} {
  return {
    report: readJson(dir, "report.json"),
    state: readJson(dir, "state.json"),
    chat: existsSync(join(dir, "chat.json")) ? readJson(dir, "chat.json") : [],
    masterTex: readFileSync(join(dir, "master.tex"), "utf8"),
  };
}

export function writeState(dir: string, state: RunState): void {
  writeFileSync(join(dir, "state.json"), JSON.stringify(state, null, 2), "utf8");
}

export function writeChat(dir: string, chat: ChatMessage[]): void {
  writeFileSync(join(dir, "chat.json"), JSON.stringify(chat, null, 2), "utf8");
}

// Pre-run-folder applications (report.json without runId) are skipped.
function allRuns(appsDir: string): { dir: string; report: RunFile }[] {
  if (!existsSync(appsDir)) return [];
  return readdirSync(appsDir).flatMap((name) => {
    const dir = join(appsDir, name);
    try {
      const report = readJson(dir, "report.json") as RunFile;
      return report.runId ? [{ dir, report }] : [];
    } catch {
      return [];
    }
  });
}

export function scanRuns(appsDir: string): Map<string, string> {
  return new Map(allRuns(appsDir).map((r) => [r.report.runId, r.dir]));
}

export function runsForApplication(
  appsDir: string,
  applicationId: string,
): { dir: string; report: RunFile }[] {
  return allRuns(appsDir)
    .filter((r) => r.report.applicationId === applicationId)
    .sort((a, b) => b.report.createdAt.localeCompare(a.report.createdAt));
}
