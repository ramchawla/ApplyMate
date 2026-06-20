import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import pgvector from "pgvector/pg";
import { embedBatch } from "../embeddings/embedder";
import type { ExperienceAnchor } from "../types";

const { Client } = pg;

const CONNECTION =
  process.env.APPLYMATE_PG_URL ??
  "postgres://applymate:applymate@localhost:5433/applymate";

export async function connect(): Promise<pg.Client> {
  const client = new Client({ connectionString: CONNECTION });
  await client.connect();
  // The vector type must exist before pgvector can register its OID.
  await client.query("CREATE EXTENSION IF NOT EXISTS vector");
  await pgvector.registerType(client);
  return client;
}

export async function migrate(client: pg.Client): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = await readFile(join(here, "..", "..", "db", "schema.sql"), "utf8");
  await client.query(sql);
}

export async function upsertAnchors(
  client: pg.Client,
  anchors: ExperienceAnchor[],
): Promise<void> {
  if (anchors.length === 0) return;
  const texts = anchors.map(
    (a) =>
      `${a.title}. ${a.description} ${a.skills.join(" ")} ${a.tags.join(" ")}`,
  );
  const vectors = await embedBatch(texts);

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    await client.query(
      `INSERT INTO experiences (id, title, description, skills, metrics, tags, claim_anchor, embedding)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         title=$2, description=$3, skills=$4, metrics=$5, tags=$6, claim_anchor=$7, embedding=$8`,
      [
        a.id,
        a.title,
        a.description,
        a.skills,
        a.metrics,
        a.tags,
        a.claimAnchor,
        pgvector.toSql(vectors[i]),
      ],
    );
  }
}

export async function knnSearch(
  client: pg.Client,
  queryVec: number[],
  k: number,
): Promise<{ id: string; score: number }[]> {
  const res = await client.query(
    `SELECT id, 1 - (embedding <=> $1) AS score
     FROM experiences
     ORDER BY embedding <=> $1
     LIMIT $2`,
    [pgvector.toSql(queryVec), k],
  );
  return res.rows.map((r) => ({ id: r.id, score: Number(r.score) }));
}
