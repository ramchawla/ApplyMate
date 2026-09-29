import type { FormField } from "../../../../../lib/shared/types";
import {
  AUTOCOMPLETE_TYPES,
  FIELD_TYPE_KEYWORDS,
  LONG_LABEL_TYPES,
  SHORT_LABEL_MAX,
} from "../../../../../lib/shared/constants";
import {
  FIELD_ATTR,
  PLACEHOLDER,
  cleanText,
  cssEscape,
  deepQueryAll,
  isListboxButton,
  isPromptInput,
  rootOf,
  toggleButtons,
} from "../dom";

// Required markers (* or Lever's ✱) end the question; ATSs append helper
// text after them ("Current location ✱No location found…").
function labelText(raw: string): string {
  const head = raw.split(/[✱*]/)[0];
  return cleanText(head.trim() ? head : raw);
}
const REQUIRED_MARK = /[✱*]/;

const SKIP_TYPES = new Set(["hidden", "submit", "button", "reset", "image", "search", "password"]);
const QUESTION_SELECTOR =
  "label, legend, [class*='label'], [class*='Label'], [class*='question'], [class*='Question']";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasPhrase(text: string, phrase: string): boolean {
  return new RegExp(`(^|[^a-z])${escapeRe(phrase)}($|[^a-z])`).test(text);
}

const NOT_PROFILE =
  /\b(middle name|address line 2|address 2|extension|device type|phone type|(country )?phone code|country code)\b/i;

export function inferValueType(
  label: string,
  htmlType: string,
  autocomplete: string,
  type: FormField["type"],
): { valueType: string | null; confidence: number } {
  const token = autocomplete.toLowerCase().trim().split(/\s+/).pop() ?? "";
  if (AUTOCOMPLETE_TYPES[token]) return { valueType: AUTOCOMPLETE_TYPES[token], confidence: 0.95 };

  const text = label.toLowerCase();
  // Contains a mapped word but means something else: never a profile value.
  if (NOT_PROFILE.test(text)) return { valueType: null, confidence: 0 };
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

// Text of the elements named by an id-list attribute (aria-labelledby,
// aria-describedby).
function textOfIds(ids: string | null, root: Document | ShadowRoot): string {
  if (!ids) return "";
  return ids
    .split(/\s+/)
    .map((id) => root.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
}

function labelledBy(el: Element): string {
  return textOfIds(el.getAttribute("aria-labelledby"), rootOf(el));
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

function rawLabel(el: HTMLElement): string {
  const root = rootOf(el);
  if (el.id) {
    const l = root.querySelector(`label[for="${cssEscape(el.id)}"]`);
    if (l?.textContent?.trim()) return l.textContent;
  }
  const wrap = el.closest("label");
  if (wrap?.textContent?.trim()) return wrap.textContent;
  const byIds = labelledBy(el);
  if (byIds) return byIds;
  const aria = el.getAttribute("aria-label");
  if (aria?.trim()) return aria;
  const legend = el.closest("fieldset")?.querySelector("legend");
  if (legend?.textContent?.trim()) return legend.textContent;
  const q = questionText(el, (c) => {
    const f = c.getAttribute("for");
    // A label bound to a different, existing control isn't ours. A dangling
    // for= (Ashby omits the input id) still labels this field.
    return c.tagName === "LABEL" && !!f && f !== el.id && !!root.getElementById(f);
  });
  return q || el.getAttribute("placeholder") || el.getAttribute("name") || "";
}

function groupRawLabel(first: HTMLElement): string {
  const root = rootOf(first);
  const legend = first.closest("fieldset")?.querySelector("legend");
  if (legend?.textContent?.trim()) return legend.textContent;
  // Only the group's own container: a page-level tabpanel's aria-labelledby
  // ("Application") would otherwise label every group on the form.
  const container = first.closest("fieldset, [role=radiogroup]");
  const byIds = container ? labelledBy(container) : "";
  if (byIds) return byIds;
  // Skip option labels (wrapping or pointing at a radio/checkbox); keep the
  // question label even when it has a for= (Ashby: fieldset > label[for]).
  return questionText(first, (c) => {
    if (c.querySelector("input[type=radio], input[type=checkbox]")) return true;
    const f = c.getAttribute("for");
    const target = f ? root.getElementById(f) : null;
    return c.tagName === "LABEL" && target instanceof HTMLInputElement && /radio|checkbox/.test(target.type);
  });
}

function optionLabel(input: HTMLInputElement): string {
  if (input.id) {
    const l = rootOf(input).querySelector(`label[for="${cssEscape(input.id)}"]`);
    if (l?.textContent?.trim()) return cleanText(l.textContent);
  }
  return cleanText(input.closest("label")?.textContent ?? input.value);
}

// Captcha response boxes and hidden honeypots must never be filled — a
// filled honeypot flags the application as a bot. File inputs are exempt:
// ATSs routinely hide them behind a styled upload button.
function isTrapOrPlumbing(el: HTMLElement, htmlType: string): boolean {
  if (/captcha/i.test(`${el.id} ${el.getAttribute("name") ?? ""}`)) return true;
  // Honeypots are text-like. File, radio and checkbox inputs are routinely
  // hidden (opacity 0 / off-screen) behind styled buttons and spans.
  if (["file", "radio", "checkbox"].includes(htmlType)) return false;
  // Real browsers: one call covers ancestors, opacity and content-visibility.
  const check = (el as HTMLElement & { checkVisibility?: (o: object) => boolean }).checkVisibility;
  if (typeof check === "function" && el.ownerDocument.defaultView) {
    if (!check.call(el, { checkVisibilityCSS: true, checkOpacity: true })) return true;
    // Parked off the page (left:-9999px). The rect is viewport-relative, so
    // add the scroll offset: fields merely scrolled past are real.
    const r = el.getBoundingClientRect();
    const win = el.ownerDocument.defaultView!;
    return r.width > 0 && (r.right + win.scrollX < 0 || r.bottom + win.scrollY < 0);
  }
  // jsdom / detached documents: inline styles on the element and ancestors.
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const st = n.style;
    if (st.display === "none" || st.visibility === "hidden") return true;
    if (parseInt(st.left, 10) <= -1000 || parseInt(st.top, 10) <= -1000) return true;
  }
  return false;
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}#${i}`;
  used.add(id);
  return id;
}

// stamp=false scans without mutating the page — used for passive gating so
// React/Remix hydration never sees foreign attributes. The fill pass stamps.
// Page-lifetime counter: anonymous ids stay unique across repeated and
// scoped scans (Workday entries added later get fresh ids).
let anonSeq = 0;
const nextAnon = () => `am-${anonSeq++}`;

export function extractLiveFields(
  root: Document | Element,
  { stamp = true }: { stamp?: boolean } = {},
): FormField[] {
  const fields: FormField[] = [];
  const used = new Set<string>();
  const seenGroups = new Set<string>();

  for (const el of deepQueryAll<HTMLElement>(root, "input, textarea, select")) {
    const tag = el.tagName.toLowerCase();
    const htmlType = (el.getAttribute("type") ?? "").toLowerCase();
    if (tag === "input" && SKIP_TYPES.has(htmlType)) continue;
    // Validation mirrors (Greenhouse's requiredInput beside each dropdown).
    if (el.getAttribute("aria-hidden") === "true") continue;
    if (isTrapOrPlumbing(el, htmlType)) continue;
    // Companion checkbox mirroring a toggle-button question (Ashby yes/no).
    if (htmlType === "checkbox" && el.parentElement && toggleButtons(el.parentElement).length) continue;

    const input = el as HTMLInputElement;
    const groupInputs =
      (htmlType === "radio" || htmlType === "checkbox") && input.name
        ? Array.from(
            rootOf(el).querySelectorAll<HTMLInputElement>(
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
    if (stamp) for (const target of isGroup ? groupInputs : [el]) target.setAttribute(FIELD_ATTR, id);

    const type: FormField["type"] =
      tag === "textarea"
        ? "textarea"
        : tag === "select"
          ? "select"
          : el.getAttribute("role") === "combobox" || isPromptInput(el)
            ? "combobox"
            : ["email", "tel", "file", "checkbox", "radio", "date", "number", "url"].includes(
                  htmlType,
                )
              ? (htmlType as FormField["type"])
              : "text";

    const raw = isGroup ? groupRawLabel(el) : rawLabel(el);
    const label = labelText(raw);
    const options =
      tag === "select"
        ? Array.from((el as HTMLSelectElement).options)
            .map((o) => cleanText(o.text))
            .filter((t) => t && !/^(select|please select|choose|--)/i.test(t))
        : isGroup
          ? groupInputs.map((r) => optionLabel(r))
          : undefined;
    const { valueType, confidence } = inferValueType(
      label,
      htmlType,
      el.getAttribute("autocomplete") ?? "",
      type,
    );

    const description = cleanText(textOfIds(el.getAttribute("aria-describedby"), rootOf(el)));
    fields.push({
      id,
      label,
      type,
      placeholder: el.getAttribute("placeholder") ?? "",
      ...(description && description !== label ? { description } : {}),
      required:
        el.hasAttribute("required") ||
        el.getAttribute("aria-required") === "true" ||
        groupInputs.some((r) => r.required) ||
        REQUIRED_MARK.test(raw),
      options,
      extractedValueType: valueType,
      matchConfidence: confidence,
      validated: false,
    });
  }

  // Non-native choice groups (custom radio widgets).
  for (const group of deepQueryAll<HTMLElement>(root, "[role=radiogroup]")) {
    if (group.querySelector("input")) continue;
    const radios = Array.from(group.querySelectorAll<HTMLElement>("[role=radio]"));
    if (radios.length === 0) continue;
    const id = uniqueId(group.getAttribute(FIELD_ATTR) ?? nextAnon(), used);
    if (stamp) group.setAttribute(FIELD_ATTR, id);
    const raw =
      group.getAttribute("aria-label") || labelledBy(group) || questionText(group, () => false);
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

  // Dropdown buttons (Workday: button[aria-haspopup=listbox] showing "Select One").
  for (const btn of deepQueryAll<HTMLElement>(root, "button[aria-haspopup=listbox], [role=button][aria-haspopup=listbox]")) {
    // Page chrome (Workday's settings/language menu) is not a question.
    if (!isListboxButton(btn) || btn.closest("header, nav, [role=banner], [role=navigation]")) continue;
    const own = (btn.textContent ?? "").trim();
    const forLabel = btn.id ? rootOf(btn).querySelector(`label[for="${cssEscape(btn.id)}"]`)?.textContent : "";
    // aria-labelledby often lists the button itself ("Country Select One").
    const byIds = textOfIds(
      (btn.getAttribute("aria-labelledby") ?? "")
        .split(/\s+/)
        .filter((i) => i && i !== btn.id)
        .join(" "),
      rootOf(btn),
    );
    const raw = forLabel?.trim() || byIds || questionText(btn, () => false) || btn.getAttribute("aria-label") || "";
    const label = labelText(raw);
    if (!label) continue;
    const id = uniqueId(btn.getAttribute(FIELD_ATTR) ?? (btn.id || nextAnon()), used);
    if (stamp) btn.setAttribute(FIELD_ATTR, id);
    const { valueType, confidence } = inferValueType(label, "", "", "combobox");
    fields.push({
      id,
      label,
      type: "combobox",
      placeholder: PLACEHOLDER.test(own) ? own : "",
      required: btn.getAttribute("aria-required") === "true" || REQUIRED_MARK.test(raw),
      extractedValueType: valueType,
      matchConfidence: confidence,
      validated: false,
    });
  }

  // Toggle-button questions (Ashby "Yes" / "No").
  const seenGroupsEl = new Set<Element>();
  for (const btn of deepQueryAll<HTMLElement>(root, "button[aria-pressed], button[data-option]")) {
    const group = btn.parentElement;
    if (!group || seenGroupsEl.has(group)) continue;
    seenGroupsEl.add(group);
    const buttons = toggleButtons(group);
    if (!buttons.length) continue;
    const id = uniqueId(group.getAttribute(FIELD_ATTR) ?? nextAnon(), used);
    if (stamp) group.setAttribute(FIELD_ATTR, id);
    const raw = labelledBy(group) || questionText(group, () => false);
    const label = labelText(raw);
    const { valueType, confidence } = inferValueType(label, "radio", "", "radio");
    fields.push({
      id,
      label,
      type: "radio",
      required: REQUIRED_MARK.test(raw),
      options: buttons.map((b) => cleanText(b.textContent ?? "")),
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
