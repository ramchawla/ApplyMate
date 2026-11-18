// Chat changes the side panel pushes into the page (and the helpers the
// wizard shares with it). Never presses a button: fills and attaches only.
import { extractLiveFields } from "./extractors/form";
import { applyFill, attachFile, findField } from "./fill";
import { scopeRoot } from "./wizard";
import { sleep } from "./dom";
import { fillWorkdaySections, isWorkday } from "./adapters/workday";
import { buildInstantPlan } from "../lib/field-mapping";
import { normalizeProfile } from "../utils/profile";
import type { FormField, PageSyncMsg, TailorResult } from "../types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Send = (msg: unknown) => Promise<any>;

const SYNC_TYPES = new Set(["REATTACH_RESUME", "REFILL_ANSWER", "REFILL_COVER_LETTER"]);
export const isPageSyncMsg = (msg: unknown): msg is PageSyncMsg =>
  SYNC_TYPES.has((msg as { type?: string } | null)?.type ?? "");

// Resume parsers (Lever, Ashby, Workday) overwrite fields on upload: how long
// to let them finish before the profile values go back in.
export const PARSER_SETTLE_MS = 1500;

type SyncResult = "ok" | "not-found" | "no-bridge";

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

// The run's answer for a field: its own stamp first; else its label, but
// only when that label is unique in the run and on this step (wizards
// repeat "If yes, please explain." on many steps).
export function stateAnswer(
  result: TailorResult | undefined,
  f: FormField,
  stepFields: FormField[],
): string | undefined {
  const questions = result?.questions ?? [];
  let q = questions.find((q) => q.fieldId === f.id && labelMatches(f, q.label));
  if (!q) {
    const byLabel = questions.filter((q) => labelMatches(f, q.label));
    const onStep = byLabel.length === 1 ? stepFields.filter((s) => labelMatches(s, byLabel[0].label)) : [];
    if (onStep.length === 1) q = byLabel[0];
  }
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
): Promise<SyncResult> {
  const input = findField(doc, field.id) as HTMLInputElement | null;
  if (!input) return "not-found";
  const pdf = await send({ type: "FETCH_RUN_PDF", runId, kind });
  if (!pdf?.base64) return "no-bridge"; // background answers { error } when the bridge fails
  return attachFile(input, base64ToFile(pdf.base64, name)) ? "ok" : "not-found";
}

// Same as the ⚡ path after an attach: let the parser finish, then put the
// profile back (fields the user edited stay theirs). Fills only, no presses.
async function reapplyProfile(doc: Document, send: Send, touched: Set<string>, settleMs: number) {
  const [res] = await Promise.all([send({ type: "GET_PROFILE" }), sleep(settleMs)]);
  const profile = normalizeProfile(res?.error ? {} : res);
  // Workday entry fields are the adapter's ("Job Title" isn't the current title in
  // every entry). An empty profile makes the adapter a pure scan: nothing added or filled.
  const owned = isWorkday(doc)
    ? new Set((await fillWorkdaySections(doc, normalizeProfile({}), () => true)).owned)
    : new Set<string>();
  const fields = extractLiveFields(scopeRoot(doc)).filter((f) => !owned.has(f.id));
  await applyFill(buildInstantPlan(fields, profile).instructions, doc, (id) => touched.has(id));
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
  deps: { send: Send; touched: Set<string>; settleMs?: number },
): Promise<SyncResult> {
  const fields = extractLiveFields(scopeRoot(doc));
  let r: SyncResult = "not-found";
  if (msg.type === "REATTACH_RESUME") {
    const field = pickResumeField(fields);
    if (field) r = await attachRunPdf(doc, field, deps.send, msg.runId, "resume", msg.fileName);
    if (r === "ok") {
      attachedVersions.set(msg.runId, msg.version);
      await reapplyProfile(doc, deps.send, deps.touched, deps.settleMs ?? PARSER_SETTLE_MS);
    }
  } else if (msg.type === "REFILL_ANSWER") {
    // An ambiguous label is never guessed at: not-found.
    const matches = fields.filter((f) => !isLoneCheckbox(f) && labelMatches(f, msg.label));
    if (matches.length === 1 && (await fillExplicit(doc, matches[0], msg.value, deps.touched))) r = "ok";
  } else {
    const field = fields.find((f) => f.extractedValueType === "cover-letter");
    if (field?.type === "file") {
      if (msg.hasPdf) r = await attachRunPdf(doc, field, deps.send, msg.runId, "cover-letter", coverLetterName(msg.fileName));
    } else if (field && msg.text && (await fillExplicit(doc, field, msg.text, deps.touched))) {
      r = "ok";
    }
  }
  return r;
}
