import { useState } from "react";
import { ExtractedJobData } from "../../types";

interface Props {
  initial?: Partial<ExtractedJobData>;
  onSubmit: (data: ExtractedJobData) => void;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `manual-${Date.now()}`;
}

export function ManualEntry({ initial, onSubmit }: Props) {
  const [jobTitle, setJobTitle] = useState(initial?.jobTitle ?? "");
  const [company, setCompany] = useState(initial?.company ?? "");
  const [jd, setJd] = useState(initial?.jobDescription ?? "");

  const canSubmit =
    jobTitle.trim().length > 0 &&
    company.trim().length > 0 &&
    jd.trim().length > 0;

  function handleSubmit() {
    const data: ExtractedJobData = {
      id: initial?.id ?? makeId(),
      url: initial?.url ?? (typeof window !== "undefined" ? window.location.href : ""),
      timestamp: new Date().toISOString(),
      board: "manual",
      boardConfidence: 1,
      jobTitle: jobTitle.trim(),
      company: company.trim(),
      jobDescription: jd.trim(),
      formFields: initial?.formFields ?? [],
      userValidated: true,
      userNotes: "Manually entered",
    };
    onSubmit(data);
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold">Manual Entry</h2>
      <p className="text-xs text-gray-600">
        Job board not detected (or low confidence). Enter details below.
      </p>

      <div>
        <label className="block text-sm font-medium">Job Title</label>
        <input
          type="text"
          value={jobTitle}
          onChange={(e) => setJobTitle(e.target.value)}
          placeholder="Senior Rust Engineer"
          className="w-full border rounded px-2 py-1"
        />
      </div>

      <div>
        <label className="block text-sm font-medium">Company</label>
        <input
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Acme Corp"
          className="w-full border rounded px-2 py-1"
        />
      </div>

      <div>
        <label className="block text-sm font-medium">Job Description</label>
        <textarea
          value={jd}
          onChange={(e) => setJd(e.target.value)}
          placeholder="Paste the full job description here…"
          className="w-full border rounded px-2 py-1 h-40"
        />
      </div>

      <button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className={`w-full py-2 rounded font-medium ${
          canSubmit
            ? "bg-blue-600 text-white"
            : "bg-gray-300 text-gray-500 cursor-not-allowed"
        }`}
      >
        Continue →
      </button>
    </div>
  );
}
