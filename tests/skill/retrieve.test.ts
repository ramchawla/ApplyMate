import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type pg from "pg";
import {
  connect,
  migrate,
  upsertAnchors,
} from "../../packages/skill/src/db/pgvector";
import { loadCorpus } from "../../packages/skill/src/corpus/load";
import { parseJD } from "../../packages/skill/src/stages/parse-jd";
import { retrieve } from "../../packages/skill/src/stages/retrieve";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "experience.yaml");

let client: pg.Client;
let anchors: Awaited<ReturnType<typeof loadCorpus>>;

beforeAll(async () => {
  client = await connect();
  await migrate(client);
  await client.query("DELETE FROM experiences");
  anchors = await loadCorpus(fixture);
  await upsertAnchors(client, anchors);
});

afterAll(async () => {
  await client.end();
});

describe("retrieve", () => {
  it("ranks the Rust anchor top for a Rust JD", async () => {
    const jd = parseJD("Senior Rust Engineer, async systems, high throughput.");
    const results = await retrieve(client, jd, anchors, 2);
    expect(results[0].anchor.id).toBe("rust-async-http");
    expect(results[0].relevanceScore).toBeGreaterThan(0.3);
  });
});
