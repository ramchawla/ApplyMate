import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseResume,
  renderResume,
  isPermutation,
  matchBrace,
  partLabels,
} from "../../packages/skill/src/tailor/resume-doc";

const tex = readFileSync(
  fileURLToPath(new URL("./fixtures/resume-master.tex", import.meta.url)),
  "utf8",
);

describe("parseResume", () => {
  const doc = parseResume(tex);
  const ids = doc.parts.map((p) => p.id);

  it("exposes summary, bullets per role, and skills lines", () => {
    expect(ids).toEqual([
      "summary",
      "r0.b0",
      "r0.b1",
      "r1.b0",
      "r2.b0",
      "skills.languages",
      "skills.technologies",
    ]);
    expect(doc.parts.find((p) => p.id === "summary")!.text).toContain(
      "Backend engineer",
    );
    expect(doc.parts.find((p) => p.id === "skills.languages")!.text).toBe(
      "Rust, Go, Python",
    );
  });

  it("never exposes education or commented-out bullets", () => {
    const all = doc.parts.map((p) => p.text).join("\n");
    expect(all).not.toContain("Dean's list");
    expect(all).not.toContain("Old commented bullet");
  });

  it("gives each group a readable heading including the company", () => {
    expect(doc.groups.map((g) => g.id)).toEqual(["r0", "r1", "r2"]);
    expect(doc.groups[0].heading).toContain("Acme Corp");
    expect(doc.groups[0].heading).toContain("Senior Software Engineer");
    expect(doc.groups[1].heading).toContain("Acme Corp");
    expect(doc.groups[1].heading).toContain("Software Engineer");
    expect(doc.groups[2].heading).toContain("Widget");
    expect(doc.groups[0].bulletIds).toEqual(["r0.b0", "r0.b1"]);
  });
});

describe("renderResume", () => {
  const doc = parseResume(tex);

  it("round-trips byte-identically with no edits", () => {
    expect(renderResume(doc)).toBe(tex);
  });

  it("splices an edit into exactly its slot", () => {
    const out = renderResume(doc, {
      "r1.b0": "Moved \\textbf{15+ services} to K8s.",
    });
    expect(out).toContain("\\resumeItem{Moved \\textbf{15+ services} to K8s.}");
    expect(out).not.toContain("Migrated \\textbf{15+ services}");
    expect(out.replace("Moved \\textbf{15+ services} to K8s.", "")).toBe(
      tex.replace("Migrated \\textbf{15+ services} to \\textbf{Kubernetes}.", ""),
    );
  });

  it("reorders bullets within a role", () => {
    const out = renderResume(doc, {}, { r0: ["r0.b1", "r0.b0"] });
    expect(out.indexOf("Cut CI time")).toBeLessThan(
      out.indexOf("Built a \\textbf{Rust}"),
    );
  });

  it("ignores an order that is not a permutation of the role's bullets", () => {
    expect(renderResume(doc, {}, { r0: ["r0.b1", "r1.b0"] })).toBe(tex);
  });

  it("applies edits and order together", () => {
    const out = renderResume(doc, { "r0.b0": "EDITED" }, { r0: ["r0.b1", "r0.b0"] });
    expect(out.indexOf("Cut CI time")).toBeLessThan(out.indexOf("EDITED"));
  });
});

describe("helpers", () => {
  it("matchBrace skips escaped braces and percent", () => {
    const s = "{a \\{ b \\% {c}}";
    expect(matchBrace(s, 0)).toBe(s.length - 1);
  });
  it("isPermutation", () => {
    expect(isPermutation(["a", "b"], ["b", "a"])).toBe(true);
    expect(isPermutation(["a", "a"], ["a", "b"])).toBe(false);
    expect(isPermutation(["a"], ["a", "b"])).toBe(false);
  });
});

describe("real master resume (local only)", () => {
  const path = join(homedir(), ".applymate", "resume-master.tex");
  it.runIf(existsSync(path))("round-trips and exposes every bullet", () => {
    const real = readFileSync(path, "utf8");
    const doc = parseResume(real);
    expect(renderResume(doc)).toBe(real);
    const itemCount = (real.match(/^\s*\\resumeItem\{/gm) ?? []).length;
    const bullets = doc.parts.filter((p) => p.kind === "bullet").length;
    expect(bullets).toBe(itemCount - 1); // minus the education cert line
    expect(doc.parts.some((p) => p.id === "summary")).toBe(true);
  });
});

describe("partLabels", () => {
  it("labels every part without ids", () => {
    const labels = partLabels(parseResume(tex));
    expect(labels["summary"]).toBe("Summary");
    expect(labels["r0.b0"]).toBe("Acme Corp · bullet 1");
    expect(labels["skills.languages"]).toBe("Skills · Languages");
    expect(Object.values(labels).some((l) => /r\d+\.b\d+/.test(l))).toBe(false);
  });
});
