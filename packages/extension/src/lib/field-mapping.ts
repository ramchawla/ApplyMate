import type { FormField, Profile, FillPlan, FillInstruction } from "../types";

interface OutputLike {
  coverLetter: string;
  formFieldGuidance: { fieldId: string; suggestedAnswer: string }[];
}

export function buildFillPlan(
  fields: FormField[],
  profile: Profile,
  output: OutputLike,
): FillPlan {
  const instructions: FillInstruction[] = [];
  const unmappedFieldIds: string[] = [];

  for (const field of fields) {
    const valueType = field.userSelectedValueType ?? field.extractedValueType;
    const instruction = mapField(field, valueType, profile, output);
    if (instruction) instructions.push(instruction);
    else unmappedFieldIds.push(field.id);
  }

  return { instructions, unmappedFieldIds };
}

function mapField(
  field: FormField,
  valueType: string | null | undefined,
  profile: Profile,
  output: OutputLike,
): FillInstruction | null {
  const base = { fieldId: field.id, valueType: valueType ?? "unknown" };

  switch (valueType) {
    case "name":
      return { ...base, value: profile.fullName, isFile: false };
    case "first-name":
      return { ...base, value: splitName(profile.fullName).first, isFile: false };
    case "last-name":
      return { ...base, value: splitName(profile.fullName).last, isFile: false };
    case "email":
      return { ...base, value: profile.email, isFile: false };
    case "phone":
      return { ...base, value: profile.phone, isFile: false };
    case "linkedin":
      return { ...base, value: profile.linkedin, isFile: false };
    case "github":
      return { ...base, value: profile.github, isFile: false };
    case "website":
      return { ...base, value: profile.website, isFile: false };
    case "location":
      return { ...base, value: profile.location, isFile: false };
    case "work-auth":
      return { ...base, value: profile.workAuthorization, isFile: false };
    case "salary":
      return { ...base, value: profile.salaryExpectation, isFile: false };
    case "cover-letter":
      return { ...base, value: output.coverLetter, isFile: false };
    case "custom-q": {
      const g = output.formFieldGuidance.find((x) => x.fieldId === field.id);
      return { ...base, value: g?.suggestedAnswer ?? "", isFile: false };
    }
    case "resume":
      return { ...base, value: "", isFile: true };
    default:
      return null;
  }
}

function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return { first: fullName.trim(), last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}
