import { Fragment } from "react";
import { markedDiff } from "../../../../../lib/shared/word-diff";

// Word diff of two LaTeX strings as rendered text: <del>/<ins> spans, bold kept (logic in markedDiff,
// shared with the dashboard). `plain`: letters/answers, no LaTeX, no bold.
export function Diff({ before, after, plain = false }: { before: string; after: string; plain?: boolean }) {
  return (
    <>
      {markedDiff(before, after, plain).map((p, i) => {
        const nodes = p.segs.map((s, j) => (s.bold ? <b key={j}>{s.text}</b> : <Fragment key={j}>{s.text}</Fragment>));
        return p.op === "add" ? <ins key={i}>{nodes}</ins> : p.op === "del" ? <del key={i}>{nodes}</del> : <Fragment key={i}>{nodes}</Fragment>;
      })}
    </>
  );
}
