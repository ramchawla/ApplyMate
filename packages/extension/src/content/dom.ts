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
    const init = { bubbles: true, cancelable: true };
    el.dispatchEvent(
      type === "click" || type.startsWith("mouse")
        ? new MouseEvent(type, { ...init, button: 0 })
        : new Event(type, init),
    );
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
