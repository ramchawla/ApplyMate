import type pg from "pg";
import type { ParsedJD, ExperienceAnchor, RetrievedExperience } from "../types";
import { embed } from "../embeddings/embedder";
import { knnSearch } from "../db/pgvector";

export async function retrieve(
  client: pg.Client,
  parsedJD: ParsedJD,
  anchors: ExperienceAnchor[],
  k: number,
): Promise<RetrievedExperience[]> {
  const queryText = [
    parsedJD.keywords.join(" "),
    parsedJD.mustHaves.join(" "),
  ].join(" ");

  const queryVec = await embed(queryText);
  const hits = await knnSearch(client, queryVec, k);

  const byId = new Map(anchors.map((a) => [a.id, a]));
  return hits
    .map((h) => {
      const anchor = byId.get(h.id);
      return anchor ? { anchor, relevanceScore: h.score } : null;
    })
    .filter((x): x is RetrievedExperience => x !== null);
}
