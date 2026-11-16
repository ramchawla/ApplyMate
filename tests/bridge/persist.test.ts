import { describe, it, expect, beforeEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import {
  openDb,
  migrate,
  listApplications,
  listVersions,
  type Db,
} from "../../lib/local/db";
import { persistOutput } from "../../packages/bridge/src/persist";

let db: Db;
const path = join(tmpdir(), `applymate-persist-${Date.now()}.db`);

beforeEach(() => {
  try {
    rmSync(path);
  } catch {
    /* ignore */
  }
  db = openDb(path);
  migrate(db);
});

describe("persistOutput", () => {
  it("creates an application, version, and JD row", () => {
    const { applicationId } = persistOutput(db, {
      jobUrl: "https://x.com/job",
      company: "Acme",
      jobTitle: "Rust Eng",
      resumeLatex: "\\item Built async Rust",
      coverLetter: "Dear Acme",
      parsedJD: { keywords: ["rust"] },
      rewritingReport: { overallConfidence: 0.93, perBullet: [] },
    } as any);

    expect(listApplications(db)).toHaveLength(1);
    expect(listVersions(db, applicationId)).toHaveLength(1);
  });

  it("bumps version number on repeated posts for the same job", () => {
    const payload = {
      jobUrl: "https://x.com/job",
      company: "Acme",
      jobTitle: "Rust Eng",
      resumeLatex: "\\item v",
      rewritingReport: { overallConfidence: 0.9, perBullet: [] },
    } as any;
    const first = persistOutput(db, payload);
    const second = persistOutput(db, payload);
    expect(first.applicationId).toBe(second.applicationId);
    const versions = listVersions(db, first.applicationId);
    expect(versions.map((v) => v.versionNumber).sort()).toEqual([1, 2]);
  });
});

import {
  applicationDirName,
  markApplied,
  deterministicAppId,
} from "../../packages/bridge/src/persist";

describe("application files + status", () => {
  it("names app dirs by date, company and role", () => {
    expect(
      applicationDirName(new Date("2026-09-28T12:00:00Z"), "Acme, Inc.", "Senior SWE (Platform)"),
    ).toBe("2026-09-28-acme-inc-senior-swe-platform");
    expect(applicationDirName(new Date("2026-09-28T12:00:00Z"), "", "")).toBe(
      "2026-09-28-company-role",
    );
  });

  it("marks an application applied, creating it if needed", () => {
    const id = markApplied(db, { jobUrl: "https://x.com/j2", company: "Acme", jobTitle: "SRE" });
    expect(id).toBe(deterministicAppId("https://x.com/j2"));
    const row = listApplications(db).find((a) => a.id === id)!;
    expect(row.status).toBe("applied");
    expect(row.company).toBe("Acme");
  });
});
