import "server-only";
import { homedir } from "node:os";
import { join } from "node:path";
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
import { readRun, runsForApplication } from "../../../lib/local/runs";
import { buildRunView, type RunView } from "../../../lib/shared/run-view";
import type { ChatMessage } from "../../../lib/shared/types";
import { partTexts } from "../../skill/src/tailor/resume-doc";

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

// Run folders for one application, newest first. Read at request time; an
// unreadable run is logged and skipped so one bad folder never blanks the page.
export function getRuns(
  applicationId: string,
): { runId: string; createdAt: string; view: RunView; chat: ChatMessage[] }[] {
  const appsDir = join(process.env.APPLYMATE_DIR ?? join(homedir(), ".applymate"), "applications");
  return runsForApplication(appsDir, applicationId).flatMap(({ dir }) => {
    try {
      const { report, state, chat, masterTex } = readRun(dir);
      const view = buildRunView(report, state, partTexts(masterTex));
      return [{ runId: report.runId, createdAt: report.createdAt, view, chat }];
    } catch (err) {
      console.error(`[ApplyMate] skipping unreadable run ${dir}:`, err);
      return [];
    }
  });
}
