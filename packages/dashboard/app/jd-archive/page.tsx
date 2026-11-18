import { searchJDs } from "../../lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function JdArchivePage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const q = searchParams.q ?? "";
  const results = searchJDs(q);

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">JD Archive</h1>
      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="search job descriptions…"
          className="flex-1 border rounded px-2 py-1 text-sm"
        />
        <button className="bg-blue-600 text-white px-3 rounded text-sm">
          Search
        </button>
      </form>
      {q && (
        <p className="text-xs text-text-3">
          {results.length} match(es) for “{q}”.
        </p>
      )}
      <ul className="divide-y bg-surface rounded border">
        {results.map((r) => (
          <li key={r.id} className="p-3 text-sm">
            <span className="font-medium">{r.jobTitle}</span>
            <span className="text-text-3"> — {r.company}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
