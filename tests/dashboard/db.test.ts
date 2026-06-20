import { describe, it, expect, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import {
  openDb,
  migrate,
  insertApplication,
  insertResumeVersion,
  insertJobDescription,
  listApplications,
  getApplication,
  listVersions,
  searchJobDescriptions,
  analytics,
  type Db,
} from "../../lib/local/db";

let db: Db;
const path = join(tmpdir(), `applymate-test-${Date.now()}.db`);

beforeEach(() => {
  try {
    rmSync(path);
  } catch {
    /* ignore */
  }
  db = openDb(path);
  migrate(db);
});

describe("db", () => {
  it("inserts and lists an application", () => {
    insertApplication(db, {
      id: "a1",
      company: "Acme",
      jobTitle: "Rust Eng",
      jobUrl: "https://x/job",
      status: "submitted",
    });
    const apps = listApplications(db);
    expect(apps).toHaveLength(1);
    expect(apps[0].company).toBe("Acme");
  });

  it("stores resume versions under an application", () => {
    insertApplication(db, {
      id: "a1",
      company: "Acme",
      jobTitle: "Rust Eng",
      jobUrl: "u",
      status: "drafted",
    });
    insertResumeVersion(db, {
      id: "v1",
      applicationId: "a1",
      versionNumber: 1,
      latex: "\\item A",
      overallConfidence: 0.9,
      report: { perBullet: [] },
    });
    const versions = listVersions(db, "a1");
    expect(versions).toHaveLength(1);
    expect(versions[0].latex).toContain("item A");
  });

  it("searches job descriptions by keyword", () => {
    insertApplication(db, {
      id: "a1",
      company: "Acme",
      jobTitle: "Rust Eng",
      jobUrl: "u",
      status: "drafted",
    });
    insertJobDescription(db, {
      id: "j1",
      applicationId: "a1",
      company: "Acme",
      jobTitle: "Rust Eng",
      jdText: "We need async Rust and pgvector experience.",
    });
    expect(searchJobDescriptions(db, "pgvector")).toHaveLength(1);
    expect(searchJobDescriptions(db, "kubernetes")).toHaveLength(0);
  });

  it("reports analytics counts by status", () => {
    insertApplication(db, {
      id: "a1",
      company: "A",
      jobTitle: "x",
      jobUrl: "u",
      status: "submitted",
    });
    insertApplication(db, {
      id: "a2",
      company: "B",
      jobTitle: "y",
      jobUrl: "u",
      status: "interviewed",
    });
    const stats = analytics(db);
    expect(stats.total).toBe(2);
    expect(stats.byStatus.submitted).toBe(1);
    expect(stats.byStatus.interviewed).toBe(1);
  });

  it("getApplication returns null for a missing id", () => {
    expect(getApplication(db, "nope")).toBeNull();
  });
});
