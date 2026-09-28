import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

// The manifest MUST register the content script so Chrome auto-injects it on
// supported job boards. Without this, no extraction ever runs and the side
// panel always falls back to manual entry. Regression guard for that bug.
describe("extension manifest", () => {
  const manifestPath = path.resolve(
    __dirname,
    "../../packages/extension/public/manifest.json",
  );
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

  it("declares content_scripts pointing at content.js", () => {
    expect(Array.isArray(manifest.content_scripts)).toBe(true);
    expect(manifest.content_scripts.length).toBeGreaterThan(0);

    const allJs = manifest.content_scripts.flatMap(
      (cs: { js?: string[] }) => cs.js ?? [],
    );
    expect(allJs).toContain("content.js");
  });

  it("injects on every site and frame (widget gating happens in the script)", () => {
    const cs = manifest.content_scripts[0];
    expect(cs.matches).toEqual(["<all_urls>"]);
    expect(cs.all_frames).toBe(true);
  });
});
