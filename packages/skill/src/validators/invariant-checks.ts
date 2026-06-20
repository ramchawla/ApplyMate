import type { ExperienceAnchor, ParsedJD } from "../types";

export interface InvariantInput {
  original: string;
  revised: string;
  addedKeywords: string[];
  anchors: ExperienceAnchor[];
  jdSeniority: ParsedJD["seniority"];
}

export interface InvariantResult {
  passed: boolean;
  metricsPreserved: boolean;
  droppedMetrics: string[];
  unsupportedKeywords: string[];
  seniorityInflated: boolean;
  notes: string[];
}

const SENIORITY_RANK: Record<string, number> = {
  unknown: 0,
  junior: 1,
  mid: 2,
  senior: 3,
  staff: 4,
};

// Normalizes "10k", "100ms", "50M", "40%", "5" into comparable lowercase tokens.
export function extractMetrics(text: string): string[] {
  // Number with an optional unit attached directly (no space). Multi-char
  // units listed before single-char so "100ms" matches "ms", not "m".
  const matches =
    text.toLowerCase().match(/\d+(?:\.\d+)?(?:req\/s|ms|hrs|hr|gb|mb|%|[kmbx])?/g) ??
    [];
  return matches
    .map((m) => m.replace(/req\/s|hrs?|gb|mb/g, "")) // units we don't diff on
    .map((m) => m.trim())
    .filter((m) => /\d/.test(m));
}

export function findUnsupportedKeywords(
  addedKeywords: string[],
  anchors: ExperienceAnchor[],
): string[] {
  const supported = new Set<string>();
  for (const a of anchors) {
    a.skills.forEach((s) => supported.add(s.toLowerCase()));
    a.tags.forEach((t) => supported.add(t.toLowerCase()));
  }
  return addedKeywords
    .map((k) => k.toLowerCase())
    .filter((k) => !supported.has(k));
}

export function checkInvariants(input: InvariantInput): InvariantResult {
  const notes: string[] = [];

  const originalMetrics = extractMetrics(input.original);
  const revisedMetrics = new Set(extractMetrics(input.revised));
  const droppedMetrics = originalMetrics.filter((m) => !revisedMetrics.has(m));
  const metricsPreserved = droppedMetrics.length === 0;
  if (!metricsPreserved) {
    notes.push(`Dropped or altered metrics: ${droppedMetrics.join(", ")}`);
  }

  const unsupportedKeywords = findUnsupportedKeywords(
    input.addedKeywords,
    input.anchors,
  );
  if (unsupportedKeywords.length > 0) {
    notes.push(`Unsupported keywords: ${unsupportedKeywords.join(", ")}`);
  }

  const seniorityInflated = detectSeniorityInflation(
    input.original,
    input.revised,
    notes,
  );

  const passed =
    metricsPreserved &&
    unsupportedKeywords.length === 0 &&
    !seniorityInflated;

  return {
    passed,
    metricsPreserved,
    droppedMetrics,
    unsupportedKeywords,
    seniorityInflated,
    notes,
  };
}

// Inflation = the revised bullet claims a higher seniority than the original
// bullet's own evidence (e.g. "junior" rewritten to "staff").
function detectSeniorityInflation(
  original: string,
  revised: string,
  notes: string[],
): boolean {
  const originalLevel = highestSeniorityWord(original);
  const revisedLevel = highestSeniorityWord(revised);
  if (SENIORITY_RANK[revisedLevel] > SENIORITY_RANK[originalLevel]) {
    notes.push(
      `Revised bullet claims '${revisedLevel}' but original supports only '${originalLevel}'.`,
    );
    return true;
  }
  return false;
}

function highestSeniorityWord(text: string): string {
  const t = text.toLowerCase();
  if (/\bstaff\b|\bprincipal\b/.test(t)) return "staff";
  if (/\bsenior\b/.test(t)) return "senior";
  if (/\bmid[- ]?level\b/.test(t)) return "mid";
  if (/\bjunior\b/.test(t)) return "junior";
  return "unknown";
}
