import type pg from "pg";
import type { ParsedJD, ExperienceAnchor, RetrievedExperience } from "../types";
import { embed, embedBatch } from "../embeddings/embedder";
import { knnSearch } from "../db/pgvector";
import { anchorEmbeddingText } from "../corpus/load";

function queryText(parsedJD: ParsedJD): string {
  return [parsedJD.keywords.join(" "), parsedJD.mustHaves.join(" ")].join(" ");
}

export async function retrieve(
  client: pg.Client,
  parsedJD: ParsedJD,
  anchors: ExperienceAnchor[],
  k: number,
): Promise<RetrievedExperience[]> {
  const queryVec = await embed(queryText(parsedJD));
  const hits = await knnSearch(client, queryVec, k);

  const byId = new Map(anchors.map((a) => [a.id, a]));
  return hits
    .map((h) => {
      const anchor = byId.get(h.id);
      return anchor ? { anchor, relevanceScore: h.score } : null;
    })
    .filter((x): x is RetrievedExperience => x !== null);
}

// Postgres-free retrieval over the loaded corpus. Embeddings come from the
// same local model and the same canonical anchor text, so rankings match the
// pgvector path. A personal corpus is dozens of anchors — exhaustive cosine
// search is exact and instant; the DB only pays off at much larger scale.
export async function retrieveInMemory(
  parsedJD: ParsedJD,
  anchors: ExperienceAnchor[],
  k: number,
): Promise<RetrievedExperience[]> {
  if (anchors.length === 0) return [];
  const [queryVec, ...anchorVecs] = await embedBatch([
    queryText(parsedJD),
    ...anchors.map(anchorEmbeddingText),
  ]);

  return anchors
    .map((anchor, i) => ({
      anchor,
      // Vectors are normalized by the embedder; dot product = cosine.
      relevanceScore: dot(queryVec, anchorVecs[i]),
    }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, k);
}

function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}
