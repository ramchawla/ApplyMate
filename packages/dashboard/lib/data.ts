import "server-only";
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
