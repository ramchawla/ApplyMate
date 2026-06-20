import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export type Db = DatabaseSync;

export function defaultDbPath(): string {
  return (
    process.env.APPLYMATE_DB_PATH ?? join(homedir(), ".applymate", "app.db")
  );
}

export function openDb(path: string = defaultDbPath()): Db {
  if (path !== ":memory:") {
    mkdirSync(join(path, ".."), { recursive: true });
  }
  return new DatabaseSync(path);
}

export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY,
      company TEXT NOT NULL,
      job_title TEXT NOT NULL,
      job_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'drafted',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS resume_versions (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      latex TEXT NOT NULL,
      overall_confidence REAL NOT NULL,
      report_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (application_id) REFERENCES applications(id)
    );
    CREATE TABLE IF NOT EXISTS job_descriptions (
      id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL,
      company TEXT NOT NULL,
      job_title TEXT NOT NULL,
      jd_text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (application_id) REFERENCES applications(id)
    );
  `);
}

export interface ApplicationRow {
  id: string;
  company: string;
  jobTitle: string;
  jobUrl: string;
  status: string;
  createdAt?: string;
}

export function insertApplication(db: Db, a: ApplicationRow): void {
  db.prepare(
    `INSERT INTO applications (id, company, job_title, job_url, status)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       company=excluded.company, job_title=excluded.job_title,
       job_url=excluded.job_url, status=excluded.status,
       updated_at=datetime('now')`,
  ).run(a.id, a.company, a.jobTitle, a.jobUrl, a.status);
}

export interface ResumeVersionInput {
  id: string;
  applicationId: string;
  versionNumber: number;
  latex: string;
  overallConfidence: number;
  report: unknown;
}

export function insertResumeVersion(db: Db, v: ResumeVersionInput): void {
  db.prepare(
    `INSERT INTO resume_versions
       (id, application_id, version_number, latex, overall_confidence, report_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    v.id,
    v.applicationId,
    v.versionNumber,
    v.latex,
    v.overallConfidence,
    JSON.stringify(v.report),
  );
}

export interface JobDescriptionInput {
  id: string;
  applicationId: string;
  company: string;
  jobTitle: string;
  jdText: string;
}

export function insertJobDescription(db: Db, j: JobDescriptionInput): void {
  db.prepare(
    `INSERT INTO job_descriptions (id, application_id, company, job_title, jd_text)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(j.id, j.applicationId, j.company, j.jobTitle, j.jdText);
}

export function listApplications(db: Db): ApplicationRow[] {
  const rows = db
    .prepare(
      `SELECT id, company, job_title AS jobTitle, job_url AS jobUrl, status, created_at AS createdAt
       FROM applications ORDER BY created_at DESC`,
    )
    .all();
  return rows as unknown as ApplicationRow[];
}

export function getApplication(db: Db, id: string): ApplicationRow | null {
  const row = db
    .prepare(
      `SELECT id, company, job_title AS jobTitle, job_url AS jobUrl, status, created_at AS createdAt
       FROM applications WHERE id = ?`,
    )
    .get(id);
  return (row as unknown as ApplicationRow) ?? null;
}

export interface ResumeVersionRow {
  id: string;
  applicationId: string;
  versionNumber: number;
  latex: string;
  overallConfidence: number;
  report: unknown;
  createdAt: string;
}

export function listVersions(db: Db, applicationId: string): ResumeVersionRow[] {
  const rows = db
    .prepare(
      `SELECT id, application_id AS applicationId, version_number AS versionNumber,
              latex, overall_confidence AS overallConfidence, report_json AS reportJson,
              created_at AS createdAt
       FROM resume_versions WHERE application_id = ? ORDER BY version_number DESC`,
    )
    .all(applicationId) as any[];
  return rows.map((r) => ({
    id: r.id,
    applicationId: r.applicationId,
    versionNumber: r.versionNumber,
    latex: r.latex,
    overallConfidence: r.overallConfidence,
    report: JSON.parse(r.reportJson),
    createdAt: r.createdAt,
  }));
}

export function getVersion(db: Db, id: string): ResumeVersionRow | null {
  const r = db
    .prepare(
      `SELECT id, application_id AS applicationId, version_number AS versionNumber,
              latex, overall_confidence AS overallConfidence, report_json AS reportJson,
              created_at AS createdAt
       FROM resume_versions WHERE id = ?`,
    )
    .get(id) as any;
  if (!r) return null;
  return {
    id: r.id,
    applicationId: r.applicationId,
    versionNumber: r.versionNumber,
    latex: r.latex,
    overallConfidence: r.overallConfidence,
    report: JSON.parse(r.reportJson),
    createdAt: r.createdAt,
  };
}

export function searchJobDescriptions(
  db: Db,
  keyword: string,
): { id: string; company: string; jobTitle: string }[] {
  const rows = db
    .prepare(
      `SELECT id, company, job_title AS jobTitle FROM job_descriptions
       WHERE jd_text LIKE ? ORDER BY created_at DESC`,
    )
    .all(`%${keyword}%`);
  return rows as unknown as { id: string; company: string; jobTitle: string }[];
}

export interface Analytics {
  total: number;
  byStatus: Record<string, number>;
}

export function analytics(db: Db): Analytics {
  const rows = db
    .prepare(`SELECT status, COUNT(*) AS n FROM applications GROUP BY status`)
    .all() as { status: string; n: number }[];
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    byStatus[r.status] = r.n;
    total += r.n;
  }
  return { total, byStatus };
}
