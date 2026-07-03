import type { FillInstruction } from "../types";

export interface FillResult {
  filled: string[];
  missing: string[];
}

export function applyFillPlan(
  instructions: FillInstruction[],
  doc: Document,
  highlightFieldIds: string[] = [],
): FillResult {
  const filled: string[] = [];
  const missing: string[] = [];

  for (const ins of instructions) {
    if (ins.isFile) continue; // files handled by the upload flow

    const target = findField(doc, ins.fieldId);
    if (!target) {
      missing.push(ins.fieldId);
      continue;
    }

    if (fillElement(target, ins.value)) filled.push(ins.fieldId);
    else missing.push(ins.fieldId);
  }

  // PRD: unrecognized fields highlighted so the user fills them manually.
  for (const id of highlightFieldIds) {
    const el = findField(doc, id);
    if (el) {
      el.style.outline = "3px solid #facc15";
      el.style.outlineOffset = "1px";
    }
  }

  return { filled, missing };
}

type Fillable = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

// CSS.escape is missing in some test DOM environments.
function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\\]]/g, "\\$&");
}

function findField(doc: Document, fieldId: string): Fillable | null {
  const byId = doc.getElementById(fieldId);
  if (byId && isFillable(byId)) return byId;
  const byName = doc.querySelector(`[name="${cssEscape(fieldId)}"]`);
  return byName && isFillable(byName) ? byName : null;
}

function isFillable(el: Element): el is Fillable {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

function fillElement(el: Fillable, value: string): boolean {
  if (el instanceof HTMLSelectElement) return fillSelect(el, value);

  if (el instanceof HTMLInputElement && el.type === "checkbox") {
    const on = /^(yes|true|1|on|checked)$/i.test(value.trim());
    setNativeChecked(el, on);
    fireEvents(el, ["click", "input", "change"]);
    return true;
  }

  if (el instanceof HTMLInputElement && el.type === "radio") {
    return fillRadio(el, value);
  }

  // Controlled (React/Vue) inputs shadow `.value` with an instance property
  // that tracks state; writing through the prototype's native setter updates
  // the real DOM value so the framework's change detection sees a delta when
  // the events fire.
  setNativeValue(el, value);
  fireEvents(el, ["input", "change"]);
  return true;
}

function fillSelect(el: HTMLSelectElement, value: string): boolean {
  const wanted = value.trim().toLowerCase();
  const options = Array.from(el.options);
  const match =
    options.find((o) => o.value.toLowerCase() === wanted) ??
    options.find((o) => o.text.trim().toLowerCase() === wanted) ??
    options.find((o) => o.text.trim().toLowerCase().includes(wanted));
  if (!match) return false;
  setNativeValue(el, match.value);
  fireEvents(el, ["input", "change"]);
  return true;
}

function fillRadio(el: HTMLInputElement, value: string): boolean {
  const doc = el.ownerDocument;
  const group = el.name
    ? Array.from(
        doc.querySelectorAll<HTMLInputElement>(
          `input[type="radio"][name="${cssEscape(el.name)}"]`,
        ),
      )
    : [el];
  const wanted = value.trim().toLowerCase();
  const match = group.find(
    (r) =>
      r.value.toLowerCase() === wanted ||
      labelText(r).toLowerCase().includes(wanted),
  );
  if (!match) return false;
  setNativeChecked(match, true);
  fireEvents(match, ["click", "input", "change"]);
  return true;
}

function labelText(el: HTMLInputElement): string {
  const doc = el.ownerDocument;
  if (el.id) {
    const label = doc.querySelector(`label[for="${cssEscape(el.id)}"]`);
    if (label?.textContent) return label.textContent.trim();
  }
  return el.closest("label")?.textContent?.trim() ?? "";
}

function setNativeValue(el: Fillable, value: string): void {
  const proto = Object.getPrototypeOf(el) as object;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor?.set) descriptor.set.call(el, value);
  else el.value = value;
}

function setNativeChecked(el: HTMLInputElement, checked: boolean): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(el) as object,
    "checked",
  );
  if (descriptor?.set) descriptor.set.call(el, checked);
  else el.checked = checked;
}

function fireEvents(el: Element, types: string[]): void {
  for (const type of types) {
    el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  }
}
