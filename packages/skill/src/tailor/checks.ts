import { extractMetrics, checkInvariants } from "../validators/invariant-checks";

// The one hard check: output that would break compilation.
export function latexProblem(latex: string): string | null {
  let depth = 0;
  for (let i = 0; i < latex.length; i++) {
    const c = latex[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      if (--depth < 0) return "unbalanced braces";
    } else if ("%&$#_".includes(c)) {
      return `unescaped ${c}`;
    }
  }
  return depth === 0 ? null : "unbalanced braces";
}

// Judgment-led tailoring: these never block, they tell the user what to
// double-check before submitting.
export function editWarnings(
  id: string,
  before: string,
  after: string,
  groundMetrics: Set<string>,
): string[] {
  const inv = checkInvariants({
    original: before,
    revised: after,
    addedKeywords: [],
    anchors: [],
    jdSeniority: "unknown",
  });
  const warnings: string[] = [];
  if (inv.droppedMetrics.length > 0) {
    warnings.push(`${id}: dropped metric ${inv.droppedMetrics.join(", ")}`);
  }
  const beforeMetrics = new Set(extractMetrics(before));
  const added = [
    ...new Set(
      extractMetrics(after).filter(
        (m) => !beforeMetrics.has(m) && !groundMetrics.has(m),
      ),
    ),
  ];
  if (added.length > 0) {
    warnings.push(`${id}: possible invented metric ${added.join(", ")}`);
  }
  if (inv.seniorityInflated) warnings.push(`${id}: seniority wording inflated`);
  return warnings;
}

export function keywordWarnings(
  injected: { keyword: string; where: string }[],
  groundText: string,
): string[] {
  const ground = groundText.toLowerCase();
  return injected
    .filter((k) => !ground.includes(k.keyword.toLowerCase()))
    .map(
      (k) =>
        `"${k.keyword}" (${k.where}) isn't in your corpus or master resume — reframed; make sure you can speak to it`,
    );
}
