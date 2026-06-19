import { useState } from "react";
import { FormField } from "../../types";

interface Props {
  fields: FormField[];
  onProceed: (validatedFields: FormField[]) => void;
}

const VALUE_TYPE_OPTIONS = [
  "name",
  "email",
  "phone",
  "resume",
  "cover-letter",
  "custom-q",
  "unknown",
] as const;

export function FormValidation({ fields: initialFields, onProceed }: Props) {
  const [fields, setFields] = useState<FormField[]>(
    initialFields.map((f) => ({ ...f })),
  );

  const allValidated = fields.length === 0 || fields.every((f) => f.validated);
  const validatedCount = fields.filter((f) => f.validated).length;

  function toggleValidated(index: number) {
    setFields((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], validated: !next[index].validated };
      return next;
    });
  }

  function changeFieldType(index: number, newType: string) {
    setFields((prev) => {
      const next = [...prev];
      next[index] = {
        ...next[index],
        userSelectedValueType: newType,
        validated: true,
      };
      return next;
    });
  }

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-lg font-bold">Form Validation</h2>

      {fields.length === 0 && (
        <p className="text-sm text-gray-600">
          No form fields detected. You can add them manually or proceed.
        </p>
      )}

      <div className="space-y-3">
        {fields.map((field, idx) => (
          <div key={field.id} className="border rounded p-2 space-y-2">
            <div className="text-sm font-medium">{field.label}</div>

            <div className="text-xs text-gray-600">
              Type: {field.type}, Required: {field.required ? "Yes" : "No"}
            </div>

            <div className="text-xs">
              Detected as:{" "}
              <select
                value={
                  field.userSelectedValueType ||
                  field.extractedValueType ||
                  "unknown"
                }
                onChange={(e) => changeFieldType(idx, e.target.value)}
                className="border rounded px-1 py-0"
              >
                {VALUE_TYPE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              {field.extractedValueType && (
                <span className="text-gray-500 ml-2">
                  ({Math.round(field.matchConfidence * 100)}% confidence)
                </span>
              )}
            </div>

            <label className="flex items-center text-sm">
              <input
                type="checkbox"
                checked={field.validated}
                onChange={() => toggleValidated(idx)}
                className="mr-2"
              />
              Validated
            </label>
          </div>
        ))}
      </div>

      <div className="text-sm text-gray-600">
        Status: {validatedCount} / {fields.length} validated
      </div>

      <button
        onClick={() => onProceed(fields)}
        disabled={!allValidated}
        className={`w-full py-2 rounded font-medium ${
          allValidated
            ? "bg-blue-600 text-white"
            : "bg-gray-300 text-gray-500 cursor-not-allowed"
        }`}
      >
        Proceed to Resume Generation →
      </button>
    </div>
  );
}
