import type { FormField } from "../types";
import {
  FIELD_ATTR,
  cssEscape,
  fireEvents,
  press,
  setNativeChecked,
  setNativeValue,
  toggleButtons,
  typeInto,
  deepQueryAll,
  rootOf,
  isListboxButton,
  isPromptInput,
  PLACEHOLDER,
  cleanText,
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
    deepQueryAll<HTMLElement>(doc, `[${FIELD_ATTR}="${cssEscape(fieldId)}"]`)[0] ??
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
  // Whole-word containment only: "no" must not match "Lati·no", nor "male"
  // match "fe·male" — those would be silent, sensitive misreports.
  const within = (needle: string, hay: string) =>
    new RegExp(`(^|[^a-z0-9])${escapeRe(needle)}($|[^a-z0-9])`).test(hay);
  let i = opts.indexOf(w);
  if (i !== -1) return i;
  const word = new RegExp(`^${escapeRe(w)}\\b`);
  i = opts.findIndex((o) => word.test(o));
  if (i !== -1) return i;
  if (w === "no") {
    i = opts.findIndex((o) => /^not\b/.test(o)); // "Not Hispanic or Latino"
    if (i !== -1) return i;
  }
  i = opts.findIndex((o) => within(w, o));
  if (i !== -1) return i;
  const head = w.split(",")[0].trim();
  if (head && head !== w) {
    i = opts.findIndex((o) => o.startsWith(head));
    if (i !== -1) return i;
  }
  i = opts.findIndex((o) => o.length > 2 && within(o, w));
  if (i !== -1) return i;
  return DECLINE.test(w) ? opts.findIndex((o) => DECLINE.test(o)) : -1;
}

const textOf = (el: Element) =>
  (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim();

function labelOf(input: HTMLInputElement): string {
  if (input.id) {
    const l = rootOf(input).querySelector(`label[for="${cssEscape(input.id)}"]`);
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

// Same "name" can appear in unrelated groups (real Workday repeats
// "currentlyWorkHere" across every Work Experience entry) — the stamped
// applymate id already scopes to this one group's inputs; only fall back to
// name when unstamped (fields not yet scanned through extractLiveFields).
function group(el: HTMLInputElement): HTMLInputElement[] {
  const stampId = el.getAttribute(FIELD_ATTR);
  if (stampId) {
    return Array.from(
      rootOf(el).querySelectorAll<HTMLInputElement>(`[${FIELD_ATTR}="${cssEscape(stampId)}"]`),
    ).filter((e) => e.type === el.type);
  }
  return el.name
    ? Array.from(
        rootOf(el).querySelectorAll<HTMLInputElement>(
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

const OPTION_SELECTOR =
  "[role=option], [id*='-option-'], .select__option, [data-automation-id=promptOption], [data-automation-id=menuItem]";
// Suggestion items of plain-text autocompletes (Lever location, Google Places).
const SUGGESTION_SELECTOR = `${OPTION_SELECTOR}, .dropdown-location, [class*='dropdown-results'] > *, .pac-item`;
const SUGGEST_CONTAINER = "[role=listbox], [class*='dropdown'], [class*='autocomplete'], [class*='suggest']";

// Options that belong to this combobox — never another widget's open menu
// (e.g. the phone-country picker left open beside a react-select).
function scopedOptions(input: HTMLElement): HTMLElement[] {
  const doc = input.ownerDocument;
  const root = rootOf(input);
  const byId = (id: string) => root.getElementById(id) ?? doc.getElementById(id);
  const owned = (input.getAttribute("aria-controls") ?? input.getAttribute("aria-owns") ?? "")
    .split(/\s+/)
    .map((id) => (id ? byId(id) : null))
    .filter((el): el is HTMLElement => !!el);
  if (owned.length) return owned.flatMap((el) => deepQueryAll<HTMLElement>(el, OPTION_SELECTOR));
  if (input.id) {
    const rs = deepQueryAll<HTMLElement>(doc, `[id^="react-select-${cssEscape(input.id)}-option"]`);
    if (rs.length) return rs;
  }
  const foreign = deepQueryAll<HTMLElement>(doc, "[role=combobox][aria-controls]")
    .filter((other) => other !== input)
    .map((other) => rootOf(other).getElementById(other.getAttribute("aria-controls")!))
    .filter((el): el is HTMLElement => !!el);
  return deepQueryAll<HTMLElement>(doc, OPTION_SELECTOR).filter(
    (o) =>
      !foreign.some((f) => f.contains(o)) &&
      !/^react-select-.+-option/.test(o.id), // another react-select's option
  );
}

function findOption(input: HTMLElement, value: string): HTMLElement | null {
  const options = scopedOptions(input);
  const i = matchOption(options.map(textOf), value);
  return i === -1 ? null : options[i];
}

// Resolves the moment a matching option is rendered. Driven by DOM mutations,
// not polling: Chrome throttles timers in background tabs, observers aren't.
function waitForMatch(
  input: HTMLElement,
  value: string,
  ms: number,
): Promise<HTMLElement | null> {
  const doc = input.ownerDocument;
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const done = (pick: HTMLElement | null) => {
      observer.disconnect();
      clearTimeout(timer);
      clearTimeout(quiet);
      resolve(pick);
    };
    const check = () => {
      const pick = findOption(input, value);
      if (pick) return done(pick);
      // Options rendered but none match: give it a short quiet period to
      // fail fast (a real page done rendering) rather than the full
      // timeout. A search still adding results keeps resetting this on
      // every mutation, so a slow but genuinely progressing fetch isn't cut off.
      clearTimeout(quiet);
      if (scopedOptions(input).length) quiet = setTimeout(() => done(null), 400);
    };
    const observer = new MutationObserver(check);
    const timer = setTimeout(() => done(null), ms);
    observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
    // The widget may already have opened synchronously (e.g. on the press
    // that triggered this wait) before the observer above ever attaches.
    check();
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
    typeInto(input, value.split(",")[0].trim());
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

function waitForSuggestion(box: Element, value: string, ms: number): Promise<HTMLElement | null> {
  const find = () => {
    const items = Array.from(box.querySelectorAll<HTMLElement>(SUGGESTION_SELECTOR));
    const i = matchOption(items.map(textOf), value);
    return i === -1 ? null : items[i];
  };
  const now = find();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = (pick: HTMLElement | null) => {
      observer.disconnect();
      clearTimeout(timer);
      resolve(pick);
    };
    const observer = new MutationObserver(() => {
      const pick = find();
      if (pick) done(pick);
    });
    const timer = setTimeout(() => done(null), ms);
    observer.observe(box, { childList: true, subtree: true, characterData: true });
  });
}

// Text inputs that clear themselves unless a suggestion is chosen (Lever's
// location sets a hidden selectedLocation only on pick). Type the head of
// the value, pick the best suggestion; fall back to the typed full value.
async function fillAutocompleteText(input: HTMLInputElement, box: Element, value: string): Promise<boolean> {
  input.focus();
  typeInto(input, value.split(",")[0].trim());
  const pick = await waitForSuggestion(box, value, 2000);
  if (pick) {
    press(pick);
    return true;
  }
  setNativeValue(input, value);
  fireEvents(input, ["input", "change", "blur"]);
  return true;
}

const keyTap = (el: HTMLElement, key: string) => {
  el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  el.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
};

// Workday dropdown: press the button, pick from the listbox it opens.
// Dropdown buttons (Workday) render options only while open: open, read,
// close — so Claude can answer with an exact option.
// A page mid a burst of its own work (many questions rendering, answers
// just landed) can be slow to open the next listbox — give it real room.
const LISTBOX_WAIT_MS = 5000;

export async function readOptions(btn: HTMLElement): Promise<string[]> {
  if (!isListboxButton(btn)) return [];
  press(btn);
  let options: HTMLElement[] = [];
  for (let t = 0; t < LISTBOX_WAIT_MS / 50 && !options.length; t++) {
    await sleep(50);
    options = scopedOptions(btn);
  }
  // "Select One" is the empty state, not an answer.
  const texts = options.map((o) => cleanText(o.textContent ?? "")).filter((t) => t && !PLACEHOLDER.test(t));
  keyTap(btn, "Escape");
  return texts;
}

async function fillListboxButton(btn: HTMLElement, value: string): Promise<boolean> {
  press(btn);
  const pick = await waitForMatch(btn, value, LISTBOX_WAIT_MS);
  if (!pick) {
    keyTap(btn, "Escape");
    return false;
  }
  press(pick);
  return true;
}

// Workday prompts show picks as pills beside a search box that stays empty.
function promptHasSelection(input: Element): boolean {
  const box = input.closest("[data-automation-id^='formField-']") ?? input.parentElement?.parentElement;
  return !!box?.querySelector("[data-automation-id=selectedItem]");
}

// Workday prompt: type, Enter to search, pick the matching result. An existing
// pick is kept — pressing it again can toggle a multiselect off.
async function fillPrompt(input: HTMLInputElement, value: string): Promise<boolean> {
  if (promptHasSelection(input)) return true;
  input.focus();
  typeInto(input, value.split(",")[0].trim());
  keyTap(input, "Enter");
  const pick = await waitForMatch(input, value, 3000);
  if (!pick) {
    keyTap(input, "Escape");
    return false;
  }
  const seen = new Set(scopedOptions(input));
  press(pick);
  // A category ("Job Board") opens a sub-list instead of selecting: match
  // once more among the options that just appeared.
  let fresh: HTMLElement[] = [];
  for (let t = 0; t < 8 && !fresh.length && !promptHasSelection(input); t++) {
    await sleep(50);
    fresh = scopedOptions(input).filter((o) => !seen.has(o));
  }
  if (!fresh.length) return true;
  const i = matchOption(fresh.map((o) => cleanText(o.textContent ?? "")), value);
  if (i === -1) {
    keyTap(input, "Escape");
    return false;
  }
  press(fresh[i]);
  return true;
}

async function fillElement(el: HTMLElement, value: string): Promise<boolean> {
  if (isListboxButton(el)) return fillListboxButton(el, value);
  if (el instanceof HTMLInputElement && isPromptInput(el)) return fillPrompt(el, value);
  const toggles = toggleButtons(el);
  if (toggles.length) return clickMatching(toggles, value);
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
  if (el instanceof HTMLInputElement && el.type === "text") {
    const box = el.closest("li, [data-field-path], .field, [class*='field']") ?? el.parentElement;
    if (box && (el.getAttribute("aria-autocomplete") || box.querySelector(SUGGEST_CONTAINER))) {
      return fillAutocompleteText(el, box, value);
    }
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
  // Checked at each field's own turn, not once for the whole batch up
  // front: a busy page's fills can span a minute or more, and the user may
  // edit a later field while earlier ones are still being filled.
  isTouched?: (fieldId: string) => boolean,
): Promise<FillResult> {
  const filled: string[] = [];
  const missing: string[] = [];
  for (const ins of instructions) {
    if (isTouched?.(ins.fieldId)) continue;
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

export function isFieldEmpty(el: HTMLElement): boolean {
  if (isListboxButton(el)) return PLACEHOLDER.test((el.textContent ?? "").trim()) || !(el.textContent ?? "").trim();
  const toggles = toggleButtons(el);
  if (toggles.length) return !toggles.some((b) => b.getAttribute("aria-pressed") === "true");
  if (el.getAttribute("role") === "radiogroup") return !el.querySelector("[aria-checked=true]");
  if (el instanceof HTMLInputElement && isPromptInput(el)) return !promptHasSelection(el);
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
    if (!el || !isFieldEmpty(el)) continue;
    el.style.outline = "3px solid #facc15";
    el.style.outlineOffset = "1px";
    empty.push(f.id);
  }
  return empty;
}
