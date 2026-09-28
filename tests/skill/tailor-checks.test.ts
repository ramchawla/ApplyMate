import { describe, it, expect } from "vitest";
import {
  latexProblem,
  editWarnings,
  keywordWarnings,
} from "../../packages/skill/src/tailor/checks";

describe("latexProblem", () => {
  it("accepts escaped specials and balanced braces", () => {
    expect(latexProblem("Cut \\textbf{40\\%} of \\$ spend \\& C\\# \\_x")).toBeNull();
  });
  it("flags unescaped specials", () => {
    expect(latexProblem("cut 40% of time")).toMatch(/unescaped %/);
    expect(latexProblem("R&D")).toMatch(/unescaped &/);
    expect(latexProblem("snake_case")).toMatch(/unescaped _/);
  });
  it("flags unbalanced braces", () => {
    expect(latexProblem("\\textbf{open")).toMatch(/unbalanced/);
    expect(latexProblem("close}")).toMatch(/unbalanced/);
  });
});

describe("editWarnings", () => {
  const ground = new Set(["500"]);
  it("warns on a new number not in the original or the corpus", () => {
    const w = editWarnings("r0.b0", "Cut CI by 40\\%", "Cut CI by 40\\% saving 30 hours", ground);
    expect(w.join()).toMatch(/possible invented metric 30/);
  });
  it("allows a new number that the corpus backs", () => {
    expect(editWarnings("r0.b0", "Served devs", "Served 500 devs", ground)).toEqual([]);
  });
  it("warns on a dropped metric", () => {
    expect(
      editWarnings("r0.b0", "Handled 10k req/s", "Handled heavy load", ground).join(),
    ).toMatch(/dropped metric 10k/);
  });
  it("warns on seniority inflation", () => {
    expect(
      editWarnings("r0.b0", "Built tools", "Senior lead who built tools", ground).join(),
    ).toMatch(/seniority/);
  });
});

describe("keywordWarnings", () => {
  it("flags keywords absent from corpus and master", () => {
    const w = keywordWarnings(
      [
        { keyword: "Kubernetes", where: "r1.b0" },
        { keyword: "Terraform", where: "r0.b1" },
      ],
      "skills: [kubernetes, go]",
    );
    expect(w).toHaveLength(1);
    expect(w[0]).toMatch(/Terraform/);
  });
});
