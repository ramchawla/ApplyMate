import { notFound } from "next/navigation";
import { getVersionDetail } from "../../../lib/data";
import { BulletDiff } from "../../../components/BulletDiff";
import { PdfCompiler } from "../../../components/PdfCompiler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function ResumeVersionPage({
  params,
}: {
  params: { id: string };
}) {
  const version = getVersionDetail(params.id);
  if (!version) notFound();
  const report = version.report as {
    perBullet?: {
      original: string;
      revised: string;
      plausibilityScore: number;
      invariantChecksPassed: boolean;
      warnings: string[];
    }[];
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">
        Resume Version {version.versionNumber}
      </h1>
      <div className="text-sm text-gray-500">
        {Math.round(version.overallConfidence * 100)}% overall confidence
      </div>

      <h2 className="text-lg font-medium">Bullet Changes</h2>
      <BulletDiff bullets={report.perBullet ?? []} />

      <h2 className="text-lg font-medium">PDF</h2>
      <PdfCompiler latex={version.latex} />

      <details>
        <summary className="text-sm cursor-pointer">Raw LaTeX</summary>
        <pre className="text-xs bg-white border rounded p-2 overflow-x-auto whitespace-pre-wrap">
          {version.latex}
        </pre>
      </details>
    </div>
  );
}
