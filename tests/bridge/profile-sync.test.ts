import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
// yaml is a bridge dependency, not a root one.
const { parse } = createRequire(new URL("../../packages/bridge/package.json", import.meta.url))("yaml");
import { extractProfileLists, mergeProfileLists } from "../../packages/bridge/src/profile-sync";

const lists = {
  work: [{ company: "RBC", title: "SWE", location: "Toronto, ON", start: "2026-05", end: "", current: true, description: "Platform" }],
  education: [{ school: "UofT", degree: "BSc", major: "CS", gpa: "", start: "2020", end: "2024" }],
  skills: ["TypeScript", "Kubernetes"],
  languages: ["English"],
};

describe("extractProfileLists", () => {
  it("sends the resume + corpus and maps the structured output", async () => {
    let prompt = "";
    const out = await extractProfileLists(
      async (o) => {
        prompt = o.prompt;
        return { ...lists, extra: 1 };
      },
      "\\resumeItem{tex-marker}",
      "corpus-marker",
    );
    expect(prompt).toContain("tex-marker");
    expect(prompt).toContain("corpus-marker");
    expect(out.work[0]).toMatchObject({ company: "RBC", current: "true" });
    expect(out.skills).toEqual(["TypeScript", "Kubernetes"]);
    expect(out).not.toHaveProperty("extra");
  });
});

describe("mergeProfileLists", () => {
  const synced = { ...lists, work: lists.work.map((w) => ({ ...w, current: "true" })) };
  it("fills only empty lists and keeps comments and other keys", () => {
    const yaml = `# my profile\nemail: j@x.com # keep me\nskills: [Go]\neducation:\n  school: Mine\n`;
    const out = mergeProfileLists(yaml, synced);
    expect(out).toContain("# my profile");
    expect(out).toContain("# keep me");
    const p = parse(out);
    expect(p.email).toBe("j@x.com");
    expect(p.skills).toEqual(["Go"]);
    expect(p.education).toEqual({ school: "Mine" });
    expect(p.work[0].company).toBe("RBC");
    expect(p.languages).toEqual(["English"]);
  });
  it("treats an empty legacy education object as empty", () => {
    const p = parse(mergeProfileLists(`education:\n  school: ""\n  degree: ""\n`, synced));
    expect(p.education[0].school).toBe("UofT");
  });
});
