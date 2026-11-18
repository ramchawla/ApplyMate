import { Fragment, type ReactNode } from "react";
import { wordDiff } from "../../../../../lib/shared/word-diff";
import { latexToMarked } from "../../../../../lib/shared/latex-text";

// Word diff of two LaTeX strings as rendered text: <del>/<ins> spans, bold kept.
// Bold is tracked per side (before = same+del, after = same+add), so a **run**
// that the diff splits across parts stays bold. `plain`: letters/answers, no LaTeX, no bold.
export function Diff({ before, after, plain = false }: { before: string; after: string; plain?: boolean }) {
  let boldBefore = false;
  let boldAfter = false;
  const out: ReactNode[] = [];
  const parts = plain ? wordDiff(before, after) : wordDiff(latexToMarked(before), latexToMarked(after));
  parts.forEach((p, i) => {
    const nodes: ReactNode[] = [];
    (plain ? [p.text] : p.text.split("**")).forEach((seg, j) => {
      if (j > 0) {
        if (p.op !== "add") boldBefore = !boldBefore;
        if (p.op !== "del") boldAfter = !boldAfter;
      }
      const bold = p.op === "del" ? boldBefore : boldAfter;
      if (seg) nodes.push(bold ? <b key={j}>{seg}</b> : <Fragment key={j}>{seg}</Fragment>);
    });
    if (p.op === "same") out.push(<Fragment key={i}>{nodes}</Fragment>);
    else if (p.op === "add") out.push(<ins key={i}>{nodes}</ins>);
    else out.push(<del key={i}>{nodes}</del>);
  });
  return <>{out}</>;
}
