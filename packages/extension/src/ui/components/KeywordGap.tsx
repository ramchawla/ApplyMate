import { useEffect, useState } from "react";
import { extractTechKeywords } from "../../../../../lib/shared/keywords";
import { fetchResumeKeywords } from "../../utils/bridge";

interface Props {
  jobDescription: string;
}

// Shows which JD keywords the master resume already covers and which are
// missing — the user sees the gap before generation, mirroring the
// plausibility-report-first principle used elsewhere.
export function KeywordGap({ jobDescription }: Props) {
  const [resumeKeywords, setResumeKeywords] = useState<string[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void fetchResumeKeywords().then((kw) => {
      if (active) {
        setResumeKeywords(kw);
        setLoaded(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const jdKeywords = extractTechKeywords(jobDescription);
  if (jdKeywords.length === 0) return null;

  if (!loaded) {
    return <div className="text-xs text-gray-500">Checking keyword coverage…</div>;
  }

  if (resumeKeywords === null) {
    return (
      <div className="text-xs text-gray-500">
        Keyword coverage unavailable (bridge offline or no master resume).
      </div>
    );
  }

  const covered = jdKeywords.filter((k) => resumeKeywords.includes(k));
  const missing = jdKeywords.filter((k) => !resumeKeywords.includes(k));

  return (
    <div className="border rounded p-2 text-xs space-y-2">
      <div className="font-medium">
        Keyword coverage: {covered.length}/{jdKeywords.length}
      </div>
      {covered.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {covered.map((k) => (
            <span
              key={k}
              className="bg-green-100 text-green-800 rounded px-1.5 py-0.5"
            >
              {k}
            </span>
          ))}
        </div>
      )}
      {missing.length > 0 && (
        <>
          <div className="text-red-700">Missing from master resume:</div>
          <div className="flex flex-wrap gap-1">
            {missing.map((k) => (
              <span
                key={k}
                className="bg-red-100 text-red-800 rounded px-1.5 py-0.5"
              >
                {k}
              </span>
            ))}
          </div>
          <div className="text-gray-500">
            Anchor validation only injects keywords backed by your corpus —
            missing ones will stay out unless your experience covers them.
          </div>
        </>
      )}
    </div>
  );
}
