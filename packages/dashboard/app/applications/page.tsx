import Link from "next/link";
import { getApplications } from "../../lib/data";
import { StatusBadge } from "../../components/StatusBadge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function ApplicationsPage() {
  const apps = getApplications();
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-bold">Applications</h1>
      {apps.length === 0 && (
        <p className="text-sm text-text-3">
          No applications yet. Run <code>/apply-to-job</code> with the bridge
          running.
        </p>
      )}
      <ul className="divide-y bg-surface rounded border">
        {apps.map((a) => (
          <li key={a.id} className="p-3 flex items-center justify-between">
            <Link href={`/applications/${a.id}`} className="hover:underline">
              <span className="font-medium">{a.jobTitle}</span>
              <span className="text-text-3"> — {a.company}</span>
            </Link>
            <StatusBadge status={a.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}
