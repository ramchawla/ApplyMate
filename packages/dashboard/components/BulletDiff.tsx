import { Fragment } from "react";
import { markedDiff } from "../../../lib/shared/word-diff";

// Same rendering as the side panel's Diff (logic shared in markedDiff; React can't be
// shared from lib/ without cross-package resolution config).
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

// A version row's perBullet: legacy {original, revised, score} or a run's tailoring edits {before, after, reverted}.
interface Bullet {
  original?: string;
  revised?: string;
  before?: string;
  after?: string;
  reverted?: string;
  plausibilityScore?: number;
  invariantChecksPassed?: boolean;
  warnings?: string[];
}

export function BulletDiff({ bullets }: { bullets: Bullet[] }) {
  return (
    <div className="space-y-2">
      {bullets.map((b, i) => (
        <div key={i} className="bg-surface border border-border rounded-card px-4 py-3 space-y-1">
          <div className="text-text-2 leading-[1.65] [&_b]:text-text [&_b]:font-semibold">
            <Diff before={b.original ?? b.before ?? ""} after={b.revised ?? b.after ?? ""} />
          </div>
          {b.reverted && <div className="text-small text-warn">Reverted: {b.reverted}</div>}
          {b.plausibilityScore !== undefined && (
            <div className={`text-small ${b.plausibilityScore < 0.7 ? "text-err" : "text-text-3"}`}>
              {Math.round(b.plausibilityScore * 100)}% confidence
              {b.invariantChecksPassed === false ? " — invariant failed" : ""}
            </div>
          )}
          {b.warnings?.map((w, j) => (
            <div key={j} className="text-small text-warn">
              {w}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
