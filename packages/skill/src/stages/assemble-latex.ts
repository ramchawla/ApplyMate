import type { BulletRewrite } from "../types";

const MARKER = "%%BULLETS%%";

const ESCAPES: [RegExp, string][] = [
  [/\\/g, "\\textbackslash{}"],
  [/&/g, "\\&"],
  [/%/g, "\\%"],
  [/\$/g, "\\$"],
  [/#/g, "\\#"],
  [/_/g, "\\_"],
  [/\{/g, "\\{"],
  [/\}/g, "\\}"],
  [/~/g, "\\textasciitilde{}"],
  [/\^/g, "\\textasciicircum{}"],
];

export function escapeLatex(s: string): string {
  // Backslash first so we don't double-escape inserted backslashes.
  let out = s;
  for (const [re, rep] of ESCAPES) {
    out = out.replace(re, rep);
  }
  return out;
}

export function assembleLatex(
  template: string,
  rewrites: BulletRewrite[],
): string {
  if (!template.includes(MARKER)) {
    throw new Error(`Template is missing the ${MARKER} marker.`);
  }
  const items = rewrites
    .map((r) => `\\item ${escapeLatex(r.revised)}`)
    .join("\n");
  return template.replace(MARKER, items);
}
