import { parse } from "yaml";

const LATEX_ESCAPES: Record<string, string> = {
  "\\": "\\textbackslash{}",
  "&": "\\&",
  "%": "\\%",
  $: "\\$",
  "#": "\\#",
  _: "\\_",
  "{": "\\{",
  "}": "\\}",
  "~": "\\textasciitilde{}",
  "^": "\\textasciicircum{}",
};

// Plain text → LaTeX in one pass, so replacements are never re-escaped.
export function escapeLatex(s: string): string {
  return s.replace(/[\\&%$#_{}~^]/g, (c) => LATEX_ESCAPES[c]);
}

export function profileName(profileYaml: string): { first: string; last: string } {
  try {
    const p = parse(profileYaml) as { name?: { first?: unknown; last?: unknown } } | null;
    return {
      first: typeof p?.name?.first === "string" ? p.name.first : "",
      last: typeof p?.name?.last === "string" ? p.name.last : "",
    };
  } catch {
    return { first: "", last: "" };
  }
}

export function coverLetterTex(name: string, body: string): string {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.split("\n").map(escapeLatex).join("\\\\\n"));
  return [
    "\\documentclass[11pt,letterpaper]{article}",
    "\\usepackage[margin=1in]{geometry}",
    "\\usepackage[default]{lato}",
    "\\setlength{\\parindent}{0pt}",
    "\\setlength{\\parskip}{10pt}",
    "\\pagestyle{empty}",
    "\\begin{document}",
    name ? `{\\Large\\bfseries ${escapeLatex(name)}}\\par` : "",
    ...paragraphs.map((p) => `${p}\n`),
    "\\end{document}",
    "",
  ].join("\n");
}
