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
    case "email":
      return { ...base, value: profile.email, isFile: false };
    case "phone":
      return { ...base, value: profile.phone, isFile: false };
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
