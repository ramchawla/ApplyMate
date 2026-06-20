import { randomUUID } from "node:crypto";
import {
  insertApplication,
  insertResumeVersion,
  insertJobDescription,
  listVersions,
  type Db,
} from "../../../lib/local/db";

export interface PersistPayload {
  jobUrl: string;
  company?: string;
  jobTitle?: string;
  resumeLatex?: string;
  coverLetter?: string;
  parsedJD?: { keywords?: string[] } & Record<string, unknown>;
  rewritingReport?: { overallConfidence?: number; perBullet?: unknown[] };
  jobDescription?: string;
}

export function persistOutput(
  db: Db,
  payload: PersistPayload,
): { applicationId: string; versionId: string } {
  const applicationId = deterministicAppId(payload.jobUrl);

  insertApplication(db, {
    id: applicationId,
    company: payload.company ?? "Unknown",
    jobTitle: payload.jobTitle ?? "Unknown",
    jobUrl: payload.jobUrl,
    status: "drafted",
  });

  const versionNumber = listVersions(db, applicationId).length + 1;
  const versionId = randomUUID();
  insertResumeVersion(db, {
    id: versionId,
    applicationId,
    versionNumber,
    latex: payload.resumeLatex ?? "",
    overallConfidence: payload.rewritingReport?.overallConfidence ?? 0,
    report: payload.rewritingReport ?? { perBullet: [] },
  });

  if (payload.jobDescription) {
    insertJobDescription(db, {
      id: randomUUID(),
      applicationId,
      company: payload.company ?? "Unknown",
      jobTitle: payload.jobTitle ?? "Unknown",
      jdText: payload.jobDescription,
    });
  }

  return { applicationId, versionId };
}

function deterministicAppId(jobUrl: string): string {
  // Stable id per job URL so repeated tailorings group as versions.
  let hash = 0;
  for (let i = 0; i < jobUrl.length; i++) {
    hash = (hash * 31 + jobUrl.charCodeAt(i)) | 0;
  }
  return `app_${(hash >>> 0).toString(16)}`;
}
