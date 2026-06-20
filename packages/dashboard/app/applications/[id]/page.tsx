import Link from "next/link";
import { notFound } from "next/navigation";
import { getApplicationDetail } from "../../../lib/data";
import { StatusBadge } from "../../../components/StatusBadge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function ApplicationDetail({
  params,
}: {
  params: { id: string };
}) {
  const detail = getApplicationDetail(params.id);
  if (!detail) notFound();
  const { app, versions } = detail;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">
          {app.jobTitle} — {app.company}
        </h1>
        <StatusBadge status={app.status} />
      </div>
      <a
        href={app.jobUrl}
        className="text-sm text-blue-600 hover:underline"
        target="_blank"
        rel="noreferrer"
      >
        {app.jobUrl}
      </a>

      <h2 className="text-lg font-medium">Resume Versions</h2>
      <ul className="divide-y bg-white rounded border">
        {versions.map((v) => (
          <li key={v.id} className="p-3 flex items-center justify-between">
            <Link href={`/resumes/${v.id}`} className="hover:underline">
              Version {v.versionNumber}
            </Link>
            <span className="text-xs text-gray-500">
              {Math.round(v.overallConfidence * 100)}% confidence
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
