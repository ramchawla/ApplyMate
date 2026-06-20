interface Bullet {
  original: string;
  revised: string;
  plausibilityScore: number;
  invariantChecksPassed: boolean;
  warnings: string[];
}

export function BulletDiff({ bullets }: { bullets: Bullet[] }) {
  return (
    <div className="space-y-2">
      {bullets.map((b, i) => (
        <div key={i} className="border rounded p-2 text-sm space-y-1 bg-white">
          <div className="text-red-700 line-through">{b.original}</div>
          <div className="text-green-800">{b.revised}</div>
          <div
            className={
              b.plausibilityScore < 0.7 ? "text-red-600" : "text-gray-500"
            }
          >
            {Math.round(b.plausibilityScore * 100)}% confidence
            {b.invariantChecksPassed ? "" : " — invariant failed"}
          </div>
          {b.warnings.map((w, j) => (
            <div key={j} className="text-red-600 text-xs">
              ⚠️ {w}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
