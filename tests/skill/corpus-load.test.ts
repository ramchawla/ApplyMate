import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadCorpus } from "../../packages/skill/src/corpus/load";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "experience.yaml");

describe("loadCorpus", () => {
  it("parses experiences into anchors", async () => {
    const anchors = await loadCorpus(fixture);
    expect(anchors).toHaveLength(2);
    const rust = anchors.find((a) => a.id === "rust-async-http")!;
    expect(rust.skills).toContain("async");
    expect(rust.metrics).toContain("10k req/s");
    expect(rust.claimAnchor).toMatch(/async Rust/);
  });

  it("throws a clear error when the file is missing", async () => {
    await expect(loadCorpus("/no/such/file.yaml")).rejects.toThrow(
      /experience corpus not found/i,
    );
  });
});
