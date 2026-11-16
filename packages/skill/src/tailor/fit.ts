export interface Compiled {
  pdf: Buffer;
  pages: number;
  height?: number;
  goal?: number;
}

// One text line (~11pt). TeX absorbs a single extra line in glue without
// headings colliding (checked visually on the real master); two lines don't.
export const HEIGHT_SLACK_PT = 12;

// Height the resume may not exceed (plus slack). The master's natural height
// is the user's accepted density. If the current resume is already taller
// (accepted earlier), the budget relaxes to one line below it so that resume
// itself still fits and edits can't make it any taller.
export function fitBudget(master: Compiled, current?: Compiled): number {
  const base = Math.max(master.height ?? 0, master.goal ?? 0);
  return base && current?.height && current.height > base + HEIGHT_SLACK_PT
    ? current.height - HEIGHT_SLACK_PT
    : base;
}

// One page AND no taller than budget + one line. A longer resume still
// compiles to one page because TeX shrinks glue, but then headings collide.
export function fits(c: Compiled, budget: number): boolean {
  return c.pages <= 1 && (!budget || !c.height || c.height <= budget + HEIGHT_SLACK_PT);
}
