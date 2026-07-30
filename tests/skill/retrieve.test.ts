import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type pg from "pg";
import { migrate, upsertAnchors } from "../../packages/skill/src/db/pgvector";
import { loadCorpus } from "../../packages/skill/src/corpus/load";
import { parseJD } from "../../packages/skill/src/stages/parse-jd";
import {
  retrieve,
  retrieveInMemory,
} from "../../packages/skill/src/stages/retrieve";
import { tryConnect } from "./db-available";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "experience.yaml");

let client: pg.Client | null = null;
let anchors: Awaited<ReturnType<typeof loadCorpus>>;

beforeAll(async () => {
  anchors = await loadCorpus(fixture);
  client = await tryConnect();
  if (!client) return;
  await migrate(client);
  await client.query("DELETE FROM experiences");
  await upsertAnchors(client, anchors);
});

afterAll(async () => {
  await client?.end();
});

describe("retrieve (pgvector; skips without local Postgres)", () => {
  it("ranks the Rust anchor top for a Rust JD", async (ctx) => {
    if (!client) return ctx.skip();
    const jd = parseJD("Senior Rust Engineer, async systems, high throughput.");
    const results = await retrieve(client, jd, anchors, 2);
    expect(results[0].anchor.id).toBe("rust-async-http");
    expect(results[0].relevanceScore).toBeGreaterThan(0.3);
  });
});

describe("retrieveInMemory (no database required)", () => {
  it("ranks the Rust anchor top for a Rust JD", async () => {
    const jd = parseJD("Senior Rust Engineer, async systems, high throughput.");
    const results = await retrieveInMemory(jd, anchors, 2);
    expect(results[0].anchor.id).toBe("rust-async-http");
    expect(results[0].relevanceScore).toBeGreaterThan(0.3);
    expect(results).toHaveLength(2);
  });

  it("returns at most k results, sorted by score", async () => {
    const jd = parseJD("Postgres migrations with zero downtime.");
    const results = await retrieveInMemory(jd, anchors, 3);
    expect(results.length).toBeLessThanOrEqual(3);
    const scores = results.map((r) => r.relevanceScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(results[0].anchor.id).toBe("postgres-zero-downtime");
  });

  it("returns empty for an empty corpus", async () => {
    const jd = parseJD("Anything at all.");
    expect(await retrieveInMemory(jd, [], 5)).toEqual([]);
  });
});
