import type { FormField } from "../../../../../lib/shared/types";
import {
  AUTOCOMPLETE_TYPES,
  FIELD_TYPE_KEYWORDS,
  LONG_LABEL_TYPES,
  SHORT_LABEL_MAX,
} from "../../../../../lib/shared/constants";
import { FIELD_ATTR, cleanText, cssEscape } from "../dom";

const SKIP_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "search"]);
const QUESTION_SELECTOR =
  "label, legend, [class*='label'], [class*='Label'], [class*='question'], [class*='Question']";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasPhrase(text: string, phrase: string): boolean {
  return new RegExp(`(^|[^a-z])${escapeRe(phrase)}($|[^a-z])`).test(text);
}

export function inferValueType(
  label: string,
  htmlType: string,
  autocomplete: string,
  type: FormField["type"],
): { valueType: string | null; confidence: number } {
  const token = autocomplete.toLowerCase().trim().split(/\s+/).pop() ?? "";
  if (AUTOCOMPLETE_TYPES[token]) return { valueType: AUTOCOMPLETE_TYPES[token], confidence: 0.95 };

  const text = label.toLowerCase();
  if (htmlType === "file") {
    return { valueType: /cover/.test(text) ? "cover-letter" : "resume", confidence: 0.9 };
  }
  for (const [valueType, phrases] of Object.entries(FIELD_TYPE_KEYWORDS)) {
    if (text.length > SHORT_LABEL_MAX && !LONG_LABEL_TYPES.has(valueType)) continue;
    if (phrases.some((p) => hasPhrase(text, p))) return { valueType, confidence: 0.8 };
  }
  if (htmlType === "email") return { valueType: "email", confidence: 0.9 };
  if (htmlType === "tel") return { valueType: "phone", confidence: 0.9 };
  if (type === "textarea" || text.endsWith("?") || text.length > SHORT_LABEL_MAX) {
    return { valueType: "custom-q", confidence: 0.5 };
  }
  return { valueType: null, confidence: 0 };
}

function labelledBy(el: Element, doc: Document): string {
  const ids = el.getAttribute("aria-labelledby");
  if (!ids) return "";
  return ids
    .split(/\s+/)
    .map((id) => doc.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
}

// Closest label-like element that precedes `el`, isn't its container, and
// doesn't belong to another control or to an option of a choice group.
function questionText(el: Element, exclude: (c: Element) => boolean): string {
  let node = el.parentElement;
  for (let depth = 0; node && depth < 5; depth++, node = node.parentElement) {
    const candidates = Array.from(node.querySelectorAll(QUESTION_SELECTOR)).filter(
      (c) =>
        !c.contains(el) &&
        !exclude(c) &&
        (c.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 &&
        (c.textContent ?? "").trim() !== "",
    );
    const nearest = candidates[candidates.length - 1];
    if (nearest) return nearest.textContent ?? "";
  }
  return "";
}

function rawLabel(el: HTMLElement, doc: Document): string {
  if (el.id) {
    const l = doc.querySelector(`label[for="${cssEscape(el.id)}"]`);
    if (l?.textContent?.trim()) return l.textContent;
  }
  const wrap = el.closest("label");
  if (wrap?.textContent?.trim()) return wrap.textContent;
  const byIds = labelledBy(el, doc);
  if (byIds) return byIds;
  const aria = el.getAttribute("aria-label");
  if (aria?.trim()) return aria;
  const legend = el.closest("fieldset")?.querySelector("legend");
  if (legend?.textContent?.trim()) return legend.textContent;
  const q = questionText(el, (c) => {
    const f = c.getAttribute("for");
    return c.tagName === "LABEL" && !!f && f !== el.id;
  });
  return q || el.getAttribute("placeholder") || el.getAttribute("name") || "";
}

function groupRawLabel(first: HTMLElement, doc: Document): string {
  const legend = first.closest("fieldset")?.querySelector("legend");
  if (legend?.textContent?.trim()) return legend.textContent;
  const byIds = labelledBy(first.closest("[aria-labelledby]") ?? first, doc);
  if (byIds) return byIds;
  return questionText(
    first,
    (c) =>
      !!c.querySelector("input[type=radio], input[type=checkbox]") ||
      (c.tagName === "LABEL" && !!c.getAttribute("for")),
  );
}

function optionLabel(input: HTMLInputElement, doc: Document): string {
  if (input.id) {
    const l = doc.querySelector(`label[for="${cssEscape(input.id)}"]`);
    if (l?.textContent?.trim()) return cleanText(l.textContent);
  }
  return cleanText(input.closest("label")?.textContent ?? input.value);
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}#${i}`;
  used.add(id);
  return id;
}

export function extractLiveFields(doc: Document): FormField[] {
  const fields: FormField[] = [];
  const used = new Set<string>();
  const seenGroups = new Set<string>();
  let anon = 0;
  const nextAnon = () => `am-${anon++}`;

  for (const el of Array.from(doc.querySelectorAll<HTMLElement>("input, textarea, select"))) {
    const tag = el.tagName.toLowerCase();
    const htmlType = (el.getAttribute("type") ?? "").toLowerCase();
    if (tag === "input" && SKIP_TYPES.has(htmlType)) continue;

    const input = el as HTMLInputElement;
    const groupInputs =
      (htmlType === "radio" || htmlType === "checkbox") && input.name
        ? Array.from(
            doc.querySelectorAll<HTMLInputElement>(
              `input[type=${htmlType}][name="${cssEscape(input.name)}"]`,
            ),
          )
        : [];
    const isGroup = htmlType === "radio" ? groupInputs.length > 0 : groupInputs.length > 1;
    if (isGroup) {
      const key = `${htmlType}:${input.name}`;
      if (seenGroups.has(key)) continue;
      seenGroups.add(key);
    }

    const id = uniqueId(
      el.getAttribute(FIELD_ATTR) ??
        ((isGroup ? input.name : el.id || el.getAttribute("name")) || nextAnon()),
      used,
    );
    for (const target of isGroup ? groupInputs : [el]) target.setAttribute(FIELD_ATTR, id);

    const type: FormField["type"] =
      tag === "textarea"
        ? "textarea"
        : tag === "select"
          ? "select"
          : el.getAttribute("role") === "combobox"
            ? "combobox"
            : ["email", "tel", "file", "checkbox", "radio", "date", "number", "url"].includes(
                  htmlType,
                )
              ? (htmlType as FormField["type"])
              : "text";

    const raw = isGroup ? groupRawLabel(el, doc) : rawLabel(el, doc);
    const label = cleanText(raw);
    const options =
      tag === "select"
        ? Array.from((el as HTMLSelectElement).options)
            .map((o) => cleanText(o.text))
            .filter((t) => t && !/^(select|please select|choose|--)/i.test(t))
        : isGroup
          ? groupInputs.map((r) => optionLabel(r, doc))
          : undefined;
    const { valueType, confidence } = inferValueType(
      label,
      htmlType,
      el.getAttribute("autocomplete") ?? "",
      type,
    );

    fields.push({
      id,
      label,
      type,
      placeholder: el.getAttribute("placeholder") ?? "",
      required:
        el.hasAttribute("required") ||
        el.getAttribute("aria-required") === "true" ||
        groupInputs.some((r) => r.required) ||
        /\*\s*$/.test(raw.trim()),
      options,
      extractedValueType: valueType,
      matchConfidence: confidence,
      validated: false,
    });
  }

  // Non-native choice groups (custom radio widgets).
  for (const group of Array.from(doc.querySelectorAll<HTMLElement>("[role=radiogroup]"))) {
    if (group.querySelector("input")) continue;
    const radios = Array.from(group.querySelectorAll<HTMLElement>("[role=radio]"));
    if (radios.length === 0) continue;
    const id = uniqueId(group.getAttribute(FIELD_ATTR) ?? nextAnon(), used);
    group.setAttribute(FIELD_ATTR, id);
    const raw =
      group.getAttribute("aria-label") || labelledBy(group, doc) || questionText(group, () => false);
    const label = cleanText(raw);
    const { valueType, confidence } = inferValueType(label, "radio", "", "radio");
    fields.push({
      id,
      label,
      type: "radio",
      required: group.getAttribute("aria-required") === "true" || /\*\s*$/.test(raw.trim()),
      options: radios.map((r) => cleanText(r.getAttribute("aria-label") ?? r.textContent ?? "")),
      extractedValueType: valueType,
      matchConfidence: confidence,
      validated: false,
    });
  }

  return fields;
}

export function extractFormFields(html: string): FormField[] {
  return extractLiveFields(new DOMParser().parseFromString(html, "text/html"));
}
