import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type pg from "pg";
import {
  connect,
  migrate,
  upsertAnchors,
  knnSearch,
} from "../../packages/skill/src/db/pgvector";
import { loadCorpus } from "../../packages/skill/src/corpus/load";
import { embed } from "../../packages/skill/src/embeddings/embedder";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "experience.yaml");

let client: pg.Client;

beforeAll(async () => {
  client = await connect();
  await migrate(client);
  await client.query("DELETE FROM experiences");
  await upsertAnchors(client, await loadCorpus(fixture));
});

afterAll(async () => {
  await client.end();
});

describe("pgvector knnSearch", () => {
  it("returns the Rust anchor first for a Rust query", async () => {
    const q = await embed("asynchronous Rust web service with high throughput");
    const hits = await knnSearch(client, q, 2);
    expect(hits[0].id).toBe("rust-async-http");
    expect(hits[0].score).toBeGreaterThan(0.3);
  });

  it("returns the Postgres anchor first for a database query", async () => {
    const q = await embed("zero downtime database migration on a huge table");
    const hits = await knnSearch(client, q, 2);
    expect(hits[0].id).toBe("postgres-zero-downtime");
  });
});
