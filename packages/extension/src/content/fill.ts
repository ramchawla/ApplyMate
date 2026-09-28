import type { FormField } from "../types";
import { FIELD_ATTR, cssEscape, fireEvents, press, setNativeChecked, setNativeValue } from "./dom";

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
  press(els[i]);
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

// Options that belong to this combobox — never another widget's open menu
// (e.g. the phone-country picker left open beside a react-select).
function scopedOptions(input: HTMLInputElement): HTMLElement[] {
  const doc = input.ownerDocument;
  const owned = (input.getAttribute("aria-controls") ?? input.getAttribute("aria-owns") ?? "")
    .split(/\s+/)
    .map((id) => (id ? doc.getElementById(id) : null))
    .filter((el): el is HTMLElement => !!el);
  if (owned.length) return owned.flatMap((el) => Array.from(el.querySelectorAll<HTMLElement>(OPTION_SELECTOR)));
  if (input.id) {
    const rs = Array.from(
      doc.querySelectorAll<HTMLElement>(`[id^="react-select-${cssEscape(input.id)}-option"]`),
    );
    if (rs.length) return rs;
  }
  const foreign = Array.from(doc.querySelectorAll<HTMLElement>("[role=combobox][aria-controls]"))
    .filter((other) => other !== input)
    .map((other) => doc.getElementById(other.getAttribute("aria-controls")!))
    .filter((el): el is HTMLElement => !!el);
  return Array.from(doc.querySelectorAll<HTMLElement>(OPTION_SELECTOR)).filter(
    (o) =>
      !foreign.some((f) => f.contains(o)) &&
      !/^react-select-.+-option/.test(o.id), // another react-select's option
  );
}

function findOption(input: HTMLInputElement, value: string): HTMLElement | null {
  const options = scopedOptions(input);
  const i = matchOption(options.map(textOf), value);
  return i === -1 ? null : options[i];
}

// Resolves the moment a matching option is rendered. Driven by DOM mutations,
// not polling: Chrome throttles timers in background tabs, observers aren't.
function waitForMatch(
  input: HTMLInputElement,
  value: string,
  ms: number,
): Promise<HTMLElement | null> {
  const doc = input.ownerDocument;
  const now = findOption(input, value);
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = (pick: HTMLElement | null) => {
      observer.disconnect();
      clearTimeout(timer);
      resolve(pick);
    };
    const observer = new MutationObserver(() => {
      const pick = findOption(input, value);
      if (pick) done(pick);
    });
    const timer = setTimeout(() => done(null), ms);
    observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
  });
}

// react-select / Ashby / async location pickers: open the menu and pick from
// the full list; if nothing matches, type the value (city head for
// locations) to trigger search and pick from the results.
async function fillCombobox(input: HTMLInputElement, value: string): Promise<boolean> {
  const key = (k: string) => {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: k, bubbles: true, cancelable: true }));
  };
  input.focus();
  // Both triggers up front: some widgets open on press (Greenhouse: mouseup),
  // others on ArrowDown. With the menu open, ArrowDown only moves the cursor.
  press(input);
  key("ArrowDown");
  let pick = await waitForMatch(input, value, 1200);
  if (!pick) {
    setNativeValue(input, value.split(",")[0].trim());
    fireEvents(input, ["input"]);
    pick = await waitForMatch(input, value, 2500);
  }
  if (!pick) {
    // Leave no menu open behind us.
    key("Escape");
    input.blur();
    return false;
  }
  press(pick);
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
