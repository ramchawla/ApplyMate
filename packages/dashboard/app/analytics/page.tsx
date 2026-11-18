import { getAnalytics } from "../../lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function AnalyticsPage() {
  const stats = getAnalytics();
  const submitted = stats.byStatus.submitted ?? 0;
  const interviewed = stats.byStatus.interviewed ?? 0;
  const rate =
    submitted + interviewed > 0
      ? Math.round((interviewed / (submitted + interviewed)) * 100)
      : 0;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Analytics</h1>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Total applications" value={String(stats.total)} />
        <Stat label="Interview rate" value={`${rate}%`} />
      </div>
      <h2 className="text-lg font-medium">By Status</h2>
      <ul className="bg-surface rounded border divide-y">
        {Object.entries(stats.byStatus).map(([status, n]) => (
          <li key={status} className="p-2 flex justify-between text-sm">
            <span>{status}</span>
            <span className="font-medium">{n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface rounded border p-3">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-text-3">{label}</div>
    </div>
  );
}
