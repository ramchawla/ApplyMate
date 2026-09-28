import type { FormField } from "../types";
import {
  FIELD_ATTR,
  cssEscape,
  fireEvents,
  setNativeChecked,
  setNativeValue,
  sleep,
} from "./dom";

export interface FillInstruction {
  fieldId: string;
  value: string;
}

export interface FillResult {
  filled: string[];
  missing: string[];
}

export function findField(doc: Document, fieldId: string): HTMLElement | null {
  return (
    doc.querySelector<HTMLElement>(`[${FIELD_ATTR}="${cssEscape(fieldId)}"]`) ??
    doc.getElementById(fieldId) ??
    doc.querySelector<HTMLElement>(`[name="${cssEscape(fieldId)}"]`)
  );
}

const DECLINE =
  /decline|prefer not|don.?t wish|do not wish|not to (say|answer|disclose)|rather not/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Index of the option that best matches `wanted`, or -1. Options rarely match
// profile values verbatim ("Yes, I am authorized", "I don't wish to answer").
export function matchOption(options: string[], wanted: string): number {
  const w = wanted.trim().toLowerCase();
  if (!w) return -1;
  const opts = options.map((o) => o.trim().toLowerCase());
  let i = opts.indexOf(w);
  if (i !== -1) return i;
  const word = new RegExp(`^${escapeRe(w)}\\b`);
  i = opts.findIndex((o) => word.test(o));
  if (i !== -1) return i;
  i = opts.findIndex((o) => o.includes(w));
  if (i !== -1) return i;
  const head = w.split(",")[0].trim();
  if (head && head !== w) {
    i = opts.findIndex((o) => o.startsWith(head));
    if (i !== -1) return i;
  }
  i = opts.findIndex((o) => o.length > 2 && w.includes(o));
  if (i !== -1) return i;
  return DECLINE.test(w) ? opts.findIndex((o) => DECLINE.test(o)) : -1;
}

const textOf = (el: Element) =>
  (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim();

function labelOf(input: HTMLInputElement): string {
  if (input.id) {
    const l = input.ownerDocument.querySelector(`label[for="${cssEscape(input.id)}"]`);
    if (l?.textContent) return l.textContent.trim();
  }
  return (input.closest("label")?.textContent ?? input.value).trim();
}

function clickMatching(els: HTMLElement[], value: string): boolean {
  const i = matchOption(els.map(textOf), value);
  if (i === -1) return false;
  fireEvents(els[i], ["mousedown", "mouseup", "click"]);
  return true;
}

function fillSelect(el: HTMLSelectElement, value: string): boolean {
  const options = Array.from(el.options);
  let i = matchOption(
    options.map((o) => o.text),
    value,
  );
  if (i === -1) {
    i = matchOption(
      options.map((o) => o.value),
      value,
    );
  }
  if (i === -1) return false;
  setNativeValue(el, options[i].value);
  fireEvents(el, ["input", "change", "blur"]);
  return true;
}

function group(el: HTMLInputElement): HTMLInputElement[] {
  return el.name
    ? Array.from(
        el.ownerDocument.querySelectorAll<HTMLInputElement>(
          `input[type=${el.type}][name="${cssEscape(el.name)}"]`,
        ),
      )
    : [el];
}

function fillRadio(el: HTMLInputElement, value: string): boolean {
  const radios = group(el);
  const i = matchOption(radios.map(labelOf), value);
  if (i === -1) return false;
  setNativeChecked(radios[i], true);
  fireEvents(radios[i], ["click", "input", "change"]);
  return true;
}

function fillCheckbox(el: HTMLInputElement, value: string): boolean {
  const boxes = group(el);
  if (boxes.length > 1) {
    const labels = boxes.map(labelOf);
    let any = false;
    for (const part of value.split(/[,;]/)) {
      const i = matchOption(labels, part);
      if (i !== -1 && !boxes[i].checked) {
        fireEvents(boxes[i], ["click"]);
        if (!boxes[i].checked) setNativeChecked(boxes[i], true);
        fireEvents(boxes[i], ["change"]);
        any = true;
      }
    }
    return any;
  }
  const on = /^(yes|true|1|on|checked|i agree|agree)/i.test(value.trim());
  if (el.checked !== on) {
    // A dispatched click toggles natively (and runs framework handlers).
    fireEvents(el, ["click"]);
    if (el.checked !== on) setNativeChecked(el, on);
    fireEvents(el, ["input", "change"]);
  }
  return true;
}

const OPTION_SELECTOR = "[role=option], [id*='-option-'], .select__option";

async function waitForMatch(
  doc: Document,
  value: string,
  ms: number,
): Promise<HTMLElement | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const options = Array.from(doc.querySelectorAll<HTMLElement>(OPTION_SELECTOR));
    const i = matchOption(options.map(textOf), value);
    if (i !== -1) return options[i];
    if (Date.now() > deadline) return null;
    await sleep(50);
  }
}

// react-select / Ashby / async location pickers: open the menu and pick from
// the full list; if nothing matches, type the value (city head for
// locations) to trigger search and pick from the results.
async function fillCombobox(input: HTMLInputElement, value: string): Promise<boolean> {
  const doc = input.ownerDocument;
  input.focus();
  fireEvents(input, ["mousedown"]);
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  let pick = await waitForMatch(doc, value, 600);
  if (!pick) {
    setNativeValue(input, value.split(",")[0].trim());
    fireEvents(input, ["input"]);
    pick = await waitForMatch(doc, value, 2500);
  }
  if (!pick) {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return false;
  }
  fireEvents(pick, ["mousedown", "mouseup", "click"]);
  return true;
}

async function fillElement(el: HTMLElement, value: string): Promise<boolean> {
  if (el.getAttribute("role") === "radiogroup") {
    return clickMatching(Array.from(el.querySelectorAll<HTMLElement>("[role=radio]")), value);
  }
  if (el instanceof HTMLSelectElement) return fillSelect(el, value);
  if (el instanceof HTMLInputElement) {
    if (el.type === "file") return false;
    if (el.type === "radio") return fillRadio(el, value);
    if (el.type === "checkbox") return fillCheckbox(el, value);
    if (el.getAttribute("role") === "combobox") return fillCombobox(el, value);
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();
    setNativeValue(el, value);
    fireEvents(el, ["input", "change", "blur"]);
    return true;
  }
  return false;
}

export async function applyFill(
  instructions: FillInstruction[],
  doc: Document,
): Promise<FillResult> {
  const filled: string[] = [];
  const missing: string[] = [];
  for (const ins of instructions) {
    const el = findField(doc, ins.fieldId);
    if (el && ins.value.trim() && (await fillElement(el, ins.value))) filled.push(ins.fieldId);
    else missing.push(ins.fieldId);
  }
  return { filled, missing };
}

export function attachFile(input: HTMLInputElement, file: File): boolean {
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
  } catch {
    return false;
  }
  fireEvents(input, ["input", "change"]);
  return true;
}

function isEmpty(el: HTMLElement): boolean {
  if (el.getAttribute("role") === "radiogroup") return !el.querySelector("[aria-checked=true]");
  if (el instanceof HTMLInputElement) {
    if (el.type === "radio" || el.type === "checkbox") return !group(el).some((r) => r.checked);
    if (el.type === "file") return !el.files || el.files.length === 0;
    if (el.getAttribute("role") === "combobox") return false; // value lives elsewhere
  }
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    return el.value.trim() === "";
  }
  return false;
}

export function highlightEmptyRequired(doc: Document, fields: FormField[]): string[] {
  const empty: string[] = [];
  for (const f of fields) {
    if (!f.required) continue;
    const el = findField(doc, f.id);
    if (!el || !isEmpty(el)) continue;
    el.style.outline = "3px solid #facc15";
    el.style.outlineOffset = "1px";
    empty.push(f.id);
  }
  return empty;
}
