import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import type { ExperienceAnchor } from "../types";

interface RawExperience {
  id: string;
  title: string;
  description: string;
  skills?: string[];
  metrics?: string[];
  tags?: string[];
  claim_anchor: string;
}

export async function loadCorpus(path: string): Promise<ExperienceAnchor[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(
      `Experience corpus not found at ${path}. Create it with your experiences.`,
    );
  }

  const doc = parse(raw) as { experiences?: RawExperience[] } | null;
  const experiences = doc?.experiences ?? [];

  return experiences.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    skills: (e.skills ?? []).map((s) => s.toLowerCase()),
    metrics: e.metrics ?? [],
    tags: (e.tags ?? []).map((t) => t.toLowerCase()),
    claimAnchor: e.claim_anchor,
  }));
}
