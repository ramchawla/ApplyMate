export const FIELD_ATTR = "data-applymate-id";

export function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\\]]/g, "\\$&");
}

export function cleanText(s: string): string {
  return s.replace(/\s+/g, " ").replace(/\s*\*\s*$/, "").trim().slice(0, 300);
}

type Valued = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

// Controlled (React/Vue) inputs shadow `.value`; writing through the
// prototype's native setter makes the framework see the change when events fire.
export function setNativeValue(el: Valued, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el) as object, "value");
  if (descriptor?.set) descriptor.set.call(el, value);
  else el.value = value;
}

export function setNativeChecked(el: HTMLInputElement, checked: boolean): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    Object.getPrototypeOf(el) as object,
    "checked",
  );
  if (descriptor?.set) descriptor.set.call(el, checked);
  else el.checked = checked;
}

// Mouse events must be MouseEvents with button 0 — react-select ignores
// plain Events on mousedown.
export function fireEvents(el: Element, types: string[]): void {
  for (const type of types) {
    const init = { bubbles: true, cancelable: true, button: 0 };
    el.dispatchEvent(
      type.startsWith("pointer") && typeof PointerEvent === "function"
        ? new PointerEvent(type, { ...init, pointerType: "mouse", isPrimary: true })
        : type === "click" || type.startsWith("mouse") || type.startsWith("pointer")
          ? new MouseEvent(type, init)
          : new Event(type, init),
    );
  }
}

// A full human-like press. Widgets differ in which phase they act on:
// Greenhouse's react-select wrapper opens on mouseup, others on mousedown.
export function press(el: Element): void {
  fireEvents(el, ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
}

// Type like a keyboard: per character keydown → value → input → keyup.
// Autocompletes differ in which event starts a search (Lever: keydown).
export function typeInto(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  setNativeValue(el, "");
  let acc = "";
  for (const ch of text) {
    const init = { key: ch, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", init));
    acc += ch;
    setNativeValue(el, acc);
    el.dispatchEvent(
      typeof InputEvent === "function"
        ? new InputEvent("input", { data: ch, inputType: "insertText", bubbles: true })
        : new Event("input", { bubbles: true }),
    );
    el.dispatchEvent(new KeyboardEvent("keyup", init));
  }
}

// Yes/No-style questions built from toggle buttons (Ashby): a container whose
// direct children include 2-6 buttons carrying aria-pressed or data-option.
export function toggleButtons(el: Element): HTMLButtonElement[] {
  const buttons = Array.from(el.children).filter(
    (c): c is HTMLButtonElement =>
      c instanceof HTMLButtonElement && (c.hasAttribute("aria-pressed") || c.hasAttribute("data-option")),
  );
  return buttons.length >= 2 && buttons.length <= 6 ? buttons : [];
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
