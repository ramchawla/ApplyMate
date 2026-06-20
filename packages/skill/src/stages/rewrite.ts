import type {
  BulletRewrite,
  ExperienceAnchor,
  ParsedJD,
  RewritingReport,
} from "../types";
import { checkInvariants } from "../validators/invariant-checks";
import { scorePlausibility } from "../validators/plausibility";

export interface RewriteCandidate {
  original: string;
  revised: string;
  keywordsAdded: string[];
  reasonsForAddition: string[];
  logicalExtensions?: number;
  lowConfidenceMatches?: number;
}

export function validateRewrite(
  candidate: RewriteCandidate,
  anchors: ExperienceAnchor[],
  parsedJD: ParsedJD,
): BulletRewrite {
  const invariant = checkInvariants({
    original: candidate.original,
    revised: candidate.revised,
    addedKeywords: candidate.keywordsAdded,
    anchors,
    jdSeniority: parsedJD.seniority,
  });

  const plausibilityScore = scorePlausibility({
    invariant,
    logicalExtensions: candidate.logicalExtensions ?? 0,
    lowConfidenceMatches: candidate.lowConfidenceMatches ?? 0,
  });

  const metricsPreserved = collectPreservedMetrics(
    candidate.original,
    candidate.revised,
  );

  return {
    original: candidate.original,
    revised: candidate.revised,
    keywordsAdded: candidate.keywordsAdded,
    metricsPreserved,
    reasonsForAddition: candidate.reasonsForAddition,
    invariantChecksPassed: invariant.passed,
    plausibilityScore,
    validationNotes: invariant.notes,
    warnings: invariant.passed ? [] : invariant.notes.slice(),
  };
}

function collectPreservedMetrics(original: string, revised: string): string[] {
  const rev = revised.toLowerCase();
  const tokens = original.toLowerCase().match(/\d+[\w%/.]*/g) ?? [];
  return tokens.filter((t) => rev.includes(t));
}

export function buildReport(rewrites: BulletRewrite[]): RewritingReport {
  const bulletsModified = rewrites.filter(
    (r) => r.original.trim() !== r.revised.trim(),
  ).length;
  const totalKeywordsAdded = rewrites.reduce(
    (sum, r) => sum + r.keywordsAdded.length,
    0,
  );
  const allInvariantChecksPassed = rewrites.every(
    (r) => r.invariantChecksPassed,
  );
  const overallConfidence =
    rewrites.length === 0
      ? 1
      : Number(
          (
            rewrites.reduce((s, r) => s + r.plausibilityScore, 0) /
            rewrites.length
          ).toFixed(5),
        );

  const warnings = rewrites.flatMap((r) => r.warnings);
  const recommendations = buildRecommendations(rewrites);

  return {
    totalBullets: rewrites.length,
    bulletsModified,
    totalKeywordsAdded,
    perBullet: rewrites,
    summary: `${bulletsModified}/${rewrites.length} bullets modified, ${totalKeywordsAdded} keywords added, confidence ${Math.round(
      overallConfidence * 100,
    )}%.`,
    overallConfidence,
    warnings,
    recommendations,
    allInvariantChecksPassed,
  };
}

function buildRecommendations(rewrites: BulletRewrite[]): string[] {
  const recs: string[] = [];
  for (const r of rewrites) {
    for (const note of r.validationNotes) {
      const m = note.match(/Unsupported keywords: (.+)/);
      if (m) {
        recs.push(
          `Add ${m[1]} to your experience corpus if you genuinely have it.`,
        );
      }
    }
  }
  return Array.from(new Set(recs));
}
