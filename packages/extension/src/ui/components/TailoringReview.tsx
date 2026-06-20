import { useEffect, useState } from "react";
import { fetchLatestOutput } from "../../utils/bridge";

interface BulletView {
  original: string;
  revised: string;
  plausibilityScore: number;
  invariantChecksPassed: boolean;
  warnings: string[];
}

interface OutputView {
  resumeLatex: string;
  coverLetter: string;
  formFieldGuidance: { fieldId: string; suggestedAnswer: string }[];
  rewritingReport: {
    summary: string;
    overallConfidence: number;
    allInvariantChecksPassed: boolean;
    perBullet: BulletView[];
    warnings: string[];
  };
}

interface Props {
  onProceed: (output: OutputView) => void;
}

export function TailoringReview({ onProceed }: Props) {
  const [output, setOutput] = useState<OutputView | null>(null);
  const [acceptedRisky, setAcceptedRisky] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      const data = (await fetchLatestOutput()) as OutputView | null;
      if (active && data && data.rewritingReport) {
        setOutput(data);
        setLoading(false);
      }
    };
    void poll();
    const id = setInterval(poll, 2000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  if (loading || !output) {
    return (
      <div className="p-4 text-sm">
        Waiting for tailored resume from Claude Code…
        <div className="text-xs text-gray-500 mt-2">
          Run <code>/apply-to-job</code> and ensure the bridge is running
          (<code>pnpm bridge</code>). Paste the bridge token in the Form tab if
          prompted.
        </div>
      </div>
    );
  }

  const report = output.rewritingReport;
  const riskyBullets = report.perBullet.filter(
    (b) => !b.invariantChecksPassed || b.plausibilityScore < 0.7,
  );
  const canProceed = riskyBullets.length === 0 || acceptedRisky;

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold">Tailoring Review</h2>

      <div className="text-sm">
        {report.summary}{" "}
        {report.allInvariantChecksPassed ? "✓" : "⚠️ checks failed"}
      </div>

      <div className="space-y-2">
        {report.perBullet.map((b, i) => (
          <div key={i} className="border rounded p-2 text-xs space-y-1">
            <div className="line-through text-gray-400">{b.original}</div>
            <div className="font-medium">{b.revised}</div>
            <div
              className={
                b.plausibilityScore < 0.7 ? "text-red-600" : "text-green-700"
              }
            >
              {Math.round(b.plausibilityScore * 100)}% confidence
              {b.invariantChecksPassed ? "" : " — invariant failed"}
            </div>
            {b.warnings.map((w, j) => (
              <div key={j} className="text-red-600">
                ⚠️ {w}
              </div>
            ))}
          </div>
        ))}
      </div>

      <div>
        <h3 className="text-sm font-medium">Cover Letter</h3>
        <textarea
          readOnly
          value={output.coverLetter}
          className="w-full border rounded px-2 py-1 h-24 text-xs"
        />
      </div>

      {riskyBullets.length > 0 && (
        <label className="flex items-center text-xs text-red-700">
          <input
            type="checkbox"
            checked={acceptedRisky}
            onChange={(e) => setAcceptedRisky(e.target.checked)}
            className="mr-2"
          />
          I reviewed the {riskyBullets.length} low-confidence bullet(s) and
          accept them.
        </label>
      )}

      <button
        onClick={() => onProceed(output)}
        disabled={!canProceed}
        className={`w-full py-2 rounded font-medium ${
          canProceed
            ? "bg-blue-600 text-white"
            : "bg-gray-300 text-gray-500 cursor-not-allowed"
        }`}
      >
        Proceed to Form →
      </button>
    </div>
  );
}
