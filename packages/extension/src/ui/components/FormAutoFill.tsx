import { useEffect, useState } from "react";
import { FormField, Profile, FillInstruction } from "../../types";
import { getProfile } from "../../utils/profile";
import { buildFillPlan } from "../../lib/field-mapping";
import { ProfileEditor } from "./ProfileEditor";

interface OutputView {
  coverLetter: string;
  formFieldGuidance: { fieldId: string; suggestedAnswer: string }[];
}

interface Props {
  fields: FormField[];
  output: OutputView;
}

export function FormAutoFill({ fields, output }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [instructions, setInstructions] = useState<FillInstruction[]>([]);
  const [unmapped, setUnmapped] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("");

  const labelFor = (fieldId: string) =>
    fields.find((f) => f.id === fieldId)?.label ?? fieldId;

  useEffect(() => {
    void getProfile().then(setProfile);
  }, []);

  useEffect(() => {
    if (profile) {
      const plan = buildFillPlan(fields, profile, output);
      setInstructions(plan.instructions);
      setUnmapped(plan.unmappedFieldIds);
    }
  }, [profile, fields, output]);

  function editValue(fieldId: string, value: string) {
    setInstructions((prev) =>
      prev.map((i) => (i.fieldId === fieldId ? { ...i, value } : i)),
    );
  }

  function fillOnPage() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId === undefined) return;
      chrome.tabs.sendMessage(
        tabId,
        { type: "APPLY_FILL_PLAN", instructions, highlightFieldIds: unmapped },
        (res) => {
          if (res) {
            setStatus(
              `Filled ${res.filled.length} field(s); ${res.missing.length} not found.`,
            );
          }
        },
      );
    });
  }

  if (!profile) return <div className="p-4 text-xs">Loading…</div>;

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold">Form Auto-Fill</h2>

      <ProfileEditor onSaved={setProfile} />

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Field Values</h3>
        {instructions.length === 0 && (
          <p className="text-xs text-gray-500">
            No mappable fields. Check the Form Validation tab.
          </p>
        )}
        {instructions.map((ins) => (
          <div key={ins.fieldId} className="text-xs space-y-1">
            <div className="text-gray-600">
              <span className="font-medium">{labelFor(ins.fieldId)}</span>{" "}
              ({ins.valueType}){ins.isFile ? " — file, attach manually" : ""}
            </div>
            {!ins.isFile && (
              <textarea
                value={ins.value}
                onChange={(e) => editValue(ins.fieldId, e.target.value)}
                className="w-full border rounded px-2 py-1"
              />
            )}
          </div>
        ))}
      </div>

      <button
        onClick={fillOnPage}
        className="w-full bg-blue-600 text-white py-2 rounded font-medium"
      >
        Fill Form on Page
      </button>

      {status && <div className="text-xs text-green-700">{status}</div>}

      {unmapped.length > 0 && (
        <div className="text-xs text-yellow-700">
          {unmapped.length} field(s) had no mapping and are highlighted yellow
          on the page — fill them manually:
          <ul className="list-disc ml-4">
            {unmapped.map((id) => (
              <li key={id}>{labelFor(id)}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="border-t pt-3 text-xs text-red-700 font-medium">
        ⚠️ ApplyMate never submits. Review every field on the page, attach your
        resume PDF, then submit manually.
      </div>
    </div>
  );
}
