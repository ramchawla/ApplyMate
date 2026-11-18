import { describe, it, expect } from "vitest";
import { wordDiff } from "../../lib/shared/word-diff";

const join = (parts: { op: string; text: string }[], ...ops: string[]) =>
  parts.filter((p) => ops.includes(p.op)).map((p) => p.text).join("");

describe("wordDiff", () => {
  it("replaces a word: del before add, rest same", () => {
    expect(wordDiff("Led migration of 15 services", "Drove migration of 15 services")).toEqual([
      { op: "del", text: "Led " },
      { op: "add", text: "Drove " },
      { op: "same", text: "migration of 15 services" },
    ]);
  });
  it("identical text is one same part", () => {
    expect(wordDiff("a b", "a b")).toEqual([{ op: "same", text: "a b" }]);
  });
  it("empty before is a pure add", () => {
    expect(wordDiff("", "x")).toEqual([{ op: "add", text: "x" }]);
  });
  it("both empty gives no parts", () => {
    expect(wordDiff("", "")).toEqual([]);
  });
  it("mid-sentence insertion", () => {
    expect(wordDiff("Built the API fast", "Built the new API fast")).toEqual([
      { op: "same", text: "Built the " },
      { op: "add", text: "new " },
      { op: "same", text: "API fast" },
    ]);
  });
  it("keeps leading and trailing whitespace", () => {
    const d = wordDiff("  a b  ", "  a c  ");
    expect(join(d, "same", "del")).toBe("  a b  ");
    expect(join(d, "same", "add")).toBe("  a c  ");
  });
  it("round-trips before and after exactly", () => {
    const cases: [string, string][] = [
      ["Led migration of 15 services\nto k8s", "Drove migration of 12 services to  k8s now"],
      ["a b c d", "d c b a"],
      ["", "only added "],
      ["only removed\t", ""],
    ];
    for (const [b, a] of cases) {
      const d = wordDiff(b, a);
      expect(join(d, "same", "del")).toBe(b);
      expect(join(d, "same", "add")).toBe(a);
      for (let i = 1; i < d.length; i++) expect(d[i].op).not.toBe(d[i - 1].op);
    }
  });
});
