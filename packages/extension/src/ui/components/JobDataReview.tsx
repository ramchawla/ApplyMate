import { useState } from "react";
import { ExtractedJobData } from "../../types";

interface Props {
  data: ExtractedJobData;
  onNext: () => void;
}

export function JobDataReview({ data, onNext }: Props) {
  const [jobTitle, setJobTitle] = useState(data.jobTitle);
  const [company, setCompany] = useState(data.company);
  const [jd, setJd] = useState(data.jobDescription);

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold">Job Data Review</h2>

      <div>
        <label className="block text-sm font-medium">Job Title</label>
        <input
          type="text"
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          className="w-full border rounded px-2 py-1"
        />
      </div>

      <div>
        <label className="block text-sm font-medium">Company</label>
        <input
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          className="w-full border rounded px-2 py-1"
        />
      </div>

      <div>
        <label className="block text-sm font-medium">Job Description</label>
        <textarea
          value={jd}
          onChange={(e) => setJd(e.target.value)}
          className="w-full border rounded px-2 py-1 h-40"
        />
      </div>

      <div className="text-xs text-gray-500">
        Detected: {data.board} ({Math.round(data.boardConfidence * 100)}%
        confidence)
      </div>

      <button
        onClick={onNext}
        className="w-full bg-blue-600 text-white py-2 rounded font-medium"
      >
        Next: Validate Form Fields →
      </button>
    </div>
  );
}
