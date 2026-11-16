import { describe, it, expect } from "vitest";
import { fits, fitBudget } from "../../packages/skill/src/tailor/fit";

describe("fit", () => {
  it("fits: one page and height within budget + one line", () => {
    expect(fits({ pdf: Buffer.alloc(0), pages: 1, height: 700 }, 700)).toBe(true);
    expect(fits({ pdf: Buffer.alloc(0), pages: 1, height: 713 }, 700)).toBe(false);
    expect(fits({ pdf: Buffer.alloc(0), pages: 2, height: 600 }, 700)).toBe(false);
  });
  it("fitBudget: master height or goal, relaxed to a taller current resume", () => {
    expect(fitBudget({ pages: 1, height: 700, goal: 690 } as any)).toBe(700);
    expect(fitBudget({ pages: 1, height: 700 } as any, { pages: 1, height: 740 } as any)).toBe(728);
    expect(fitBudget({ pages: 1, height: 700 } as any, { pages: 1, height: 705 } as any)).toBe(700);
  });
});
