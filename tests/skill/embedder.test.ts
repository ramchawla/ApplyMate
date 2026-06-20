import { describe, it, expect } from "vitest";
import { embed, embedBatch } from "../../packages/skill/src/embeddings/embedder";

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // inputs are normalized
}

describe("embedder", () => {
  it("produces a 384-dim normalized vector", async () => {
    const v = await embed("async Rust web server");
    expect(v).toHaveLength(384);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 2);
  });

  it("ranks related text closer than unrelated text", async () => {
    const [query, related, unrelated] = await embedBatch([
      "concurrent asynchronous Rust server",
      "built an async HTTP server in Rust",
      "designed marketing brochures in Photoshop",
    ]);
    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });
});
