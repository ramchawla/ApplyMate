import type { FillInstruction } from "../types";

export function applyFillPlan(
  instructions: FillInstruction[],
  doc: Document,
): { filled: string[]; missing: string[] } {
  const filled: string[] = [];
  const missing: string[] = [];

  for (const ins of instructions) {
    if (ins.isFile) continue; // files handled by the upload flow

    const byId = doc.getElementById(ins.fieldId) as
      | HTMLInputElement
      | HTMLTextAreaElement
      | null;
    const target = byId ?? findByName(doc, ins.fieldId);

    if (!target) {
      missing.push(ins.fieldId);
      continue;
    }

    target.value = ins.value;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    filled.push(ins.fieldId);
  }

  return { filled, missing };
}

function findByName(
  doc: Document,
  name: string,
): HTMLInputElement | HTMLTextAreaElement | null {
  return doc.querySelector(`[name="${name}"]`);
}
