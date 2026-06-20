import type { ParsedJD } from "../types";

const TECH_TERMS = [
  "rust", "go", "golang", "python", "typescript", "javascript", "java",
  "c++", "postgresql", "postgres", "mysql", "redis", "docker", "kubernetes",
  "aws", "gcp", "graphql", "rest", "async", "concurrency", "react", "node",
  "wasm", "latex", "pgvector", "llm", "tectonic",
];

const SENIORITY_MAP: { re: RegExp; level: ParsedJD["seniority"] }[] = [
  { re: /\bstaff\b|\bprincipal\b/i, level: "staff" },
  { re: /\bsenior\b|\bsr\.?\b/i, level: "senior" },
  { re: /\bmid[- ]?level\b|\bintermediate\b/i, level: "mid" },
  { re: /\bjunior\b|\bjr\.?\b|\bentry[- ]?level\b/i, level: "junior" },
];

export function parseJD(jobDescription: string): ParsedJD {
  const text = jobDescription.toLowerCase();

  const keywords = Array.from(
    new Set(TECH_TERMS.filter((t) => text.includes(t))),
  );

  let seniority: ParsedJD["seniority"] = "unknown";
  for (const { re, level } of SENIORITY_MAP) {
    if (re.test(jobDescription)) {
      seniority = level;
      break;
    }
  }

  const yearsMatch = jobDescription.match(/(\d+)\s*\+?\s*years?/i);
  const yearsRequired = yearsMatch ? Number(yearsMatch[1]) : null;

  const { mustHaves, niceToHaves } = splitRequirements(jobDescription);

  return {
    keywords,
    hardSkills: keywords,
    seniority,
    yearsRequired,
    techStack: keywords,
    mustHaves,
    niceToHaves,
  };
}

function splitRequirements(jd: string): {
  mustHaves: string[];
  niceToHaves: string[];
} {
  const mustHaves: string[] = [];
  const niceToHaves: string[] = [];
  const sentences = jd.split(/[.\n]/).map((s) => s.trim()).filter(Boolean);

  for (const s of sentences) {
    if (/nice to have|plus|bonus|preferred/i.test(s)) niceToHaves.push(s);
    else if (/required|must have|you will|responsib/i.test(s)) mustHaves.push(s);
  }
  return { mustHaves, niceToHaves };
}
