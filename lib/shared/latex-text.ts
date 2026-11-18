// Resume LaTeX → plain text with **bold** markers, for display only (never fed back to LaTeX).
// Output never contains a backslash.
export function latexToMarked(latex: string): string {
  let s = latex
    .replace(/\\\\(\[[^\]]*\])?/g, " ") // \\ line break (optional [2pt])
    .replace(/(?<!\\)~/g, " ") // tie (before \sim produces a real ~)
    .replace(/\\[, ]/g, " ") // thin space, control space
    .replace(/\\(sim|textasciitilde)\b(\{\})?/g, "~")
    .replace(/\\(LaTeX|TeX)\b(\{\})?/g, "$1")
    .replace(/\\href\{[^{}]*\}\{([^{}]*)\}/g, "$1");
  // Innermost-first, so \textbf{\href{..}{x}} and \textit{\small x} unwrap fully.
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(/\\([a-zA-Z]+)\*?\{([^{}]*)\}/g, (_, cmd: string, x: string) => (cmd === "textbf" ? `**${x}**` : x));
  }
  return s
    .replace(/\\[a-zA-Z]+\s*/g, "") // argument-less commands (\small, \hfill)
    .replace(/\\([&%$#_{}~])|[{}$]/g, (_, c?: string) => c ?? "") // unescape; drop bare braces / math $
    .replace(/\\[^a-zA-Z]?/g, "") // any other escape, or a trailing backslash
    .replace(/---/g, "—")
    .replace(/--/g, "–")
    .replace(/[ \t]+/g, " ")
    .trim();
}
