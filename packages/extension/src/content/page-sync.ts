// Chat changes the side panel pushes into the page (and the helpers the
// wizard shares with it). Never presses a button: fills and attaches only.
import { extractLiveFields } from "./extractors/form";
import { applyFill, attachFile, findField } from "./fill";
import { scopeRoot } from "./wizard";
import type { FormField, PageSyncMsg, TailorResult } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Send = (msg: unknown) => Promise<any>;

const SYNC_TYPES = new Set(["REATTACH_RESUME", "REFILL_ANSWER", "REFILL_COVER_LETTER"]);
export const isPageSyncMsg = (msg: unknown): msg is PageSyncMsg =>
  SYNC_TYPES.has((msg as { type?: string } | null)?.type ?? "");

// Resume version attached per run in this frame (page lifetime only).
export const attachedVersions = new Map<string, number>();

// Wizard stamps change when a step re-renders; labels don't.
export const normalizeLabel = (s: string) =>
  s.toLowerCase().replace(/\s+/g, " ").trim().replace(/\s*\*+$/, "");

export const toQuestion = (f: FormField) => ({
  fieldId: f.id,
  label: (f.description ? `${f.label} — ${f.description}` : f.label).slice(0, 500),
  type: f.type,
  options: f.options,
  required: f.required,
});

// Asked questions carry the label plus its description; match either.
const labelMatches = (f: FormField, label: string) => {
  const want = normalizeLabel(label);
  return !!want && (normalizeLabel(f.label) === want || normalizeLabel(toQuestion(f).label) === want);
};

// Consent/terms/opt-ins are never ours to tick.
export const isLoneCheckbox = (f: FormField) => f.type === "checkbox" && (f.options?.length ?? 0) < 2;

// The run's answer for a field, matched by its question's label.
export function stateAnswer(result: TailorResult | undefined, f: FormField): string | undefined {
  const q = result?.questions?.find((q) => labelMatches(f, q.label));
  return q && result?.answers.find((a) => a.fieldId === q.fieldId)?.value;
}

// Prefer the labelled Resume field over unlabelled "autofill from resume"
// drop zones (Ashby), which re-parse and overwrite the form.
export function pickResumeField(fields: FormField[]): FormField | undefined {
  const files = fields.filter((f) => f.type === "file" && f.extractedValueType === "resume");
  return files.find((f) => /resume|cv|curriculum/i.test(f.label)) ?? files[0];
}

export const coverLetterName = (fileName: string) => fileName.replace(/\.pdf$/, "_Cover_Letter.pdf");

export function base64ToFile(b64: string, name: string): File {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: "application/pdf" });
}

async function attachRunPdf(
  doc: Document,
  field: FormField,
  send: Send,
  runId: string,
  kind: "resume" | "cover-letter",
  name: string,
): Promise<boolean> {
  const input = findField(doc, field.id) as HTMLInputElement | null;
  if (!input) return false;
  const pdf = await send({ type: "FETCH_RUN_PDF", runId, kind });
  return !!pdf?.base64 && attachFile(input, base64ToFile(pdf.base64, name));
}

// Chat applies are the user's explicit choice: they fill even a touched
// field, then mark it touched so the wizard never overwrites it.
async function fillExplicit(doc: Document, field: FormField, value: string, touched: Set<string>) {
  const { filled } = await applyFill([{ fieldId: field.id, value }], doc);
  if (filled.length) touched.add(field.id);
  return filled.length > 0;
}

export async function handlePageSync(
  doc: Document,
  msg: PageSyncMsg,
  deps: { send: Send; touched: Set<string> },
): Promise<"ok" | "not-found"> {
  const fields = extractLiveFields(scopeRoot(doc));
  let ok = false;
  if (msg.type === "REATTACH_RESUME") {
    const field = pickResumeField(fields);
    ok = !!field && (await attachRunPdf(doc, field, deps.send, msg.runId, "resume", msg.fileName));
    if (ok) attachedVersions.set(msg.runId, msg.version);
  } else if (msg.type === "REFILL_ANSWER") {
    const field = fields.find((f) => !isLoneCheckbox(f) && labelMatches(f, msg.label));
    ok = !!field && (await fillExplicit(doc, field, msg.value, deps.touched));
  } else {
    const field = fields.find((f) => f.extractedValueType === "cover-letter");
    if (field?.type === "file") {
      ok = msg.hasPdf && (await attachRunPdf(doc, field, deps.send, msg.runId, "cover-letter", coverLetterName(msg.fileName)));
    } else if (field && msg.text) {
      ok = await fillExplicit(doc, field, msg.text, deps.touched);
    }
  }
  return ok ? "ok" : "not-found";
}
