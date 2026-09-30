import { cleanText, deepQueryAll, sleep, press, typeInto } from "../dom";
import { extractLiveFields } from "../extractors/form";
import { applyFill, findField, isFieldEmpty } from "../fill";
import { isShown } from "../wizard";
import type { Profile } from "../../types";

const WORKDAY_MARKS = [
  "[data-automation-id^='formField-']",
  "[data-automation-id^='pageFooter']",
  "[data-automation-id^='bottom-navigation']",
  "[data-automation-id=applyFlowPage]",
];

export function isWorkday(doc: Document): boolean {
  return (
    /(^|\.)(myworkdayjobs|myworkdaysite|workday)\.com$/i.test(doc.location?.hostname ?? "") ||
    // Workday-specific automation ids only; plenty of sites use the attribute.
    // One query each: jsdom mis-evaluates comma lists of ^= selectors.
    WORKDAY_MARKS.some((sel) => doc.querySelector(sel))
  );
}

type Item = Record<string, string>;
interface SectionSpec {
  title: string;
  heading: RegExp; // section title
  entry: RegExp; // "Work Experience 2"
  items: (p: Profile) => Item[];
  labels: [RegExp, string][]; // field label → item key
}

const SECTIONS: SectionSpec[] = [
  {
    title: "Work Experience",
    heading: /^work experience$/i,
    entry: /^work experience \d+$/i,
    items: (p) => p.work.map((w) => ({ ...w })),
    labels: [
      [/currently work/i, "current"],
      [/job title|position|^title/i, "title"],
      [/company|employer|organi[sz]ation/i, "company"],
      [/location|city/i, "location"],
      [/description|responsibilit|summary/i, "description"],
    ],
  },
  {
    title: "Education",
    heading: /^education$/i,
    entry: /^education \d+$/i,
    items: (p) => p.education.map((e) => ({ ...e })),
    labels: [
      [/school|university|college|institution/i, "school"],
      [/degree/i, "degree"],
      [/field of study|major|discipline/i, "major"],
      [/gpa|overall result|grade/i, "gpa"],
    ],
  },
  {
    title: "Website",
    heading: /^websites?$/i,
    entry: /^websites? \d+$/i,
    // LinkedIn has its own "Social Network URLs" field on Workday.
    items: (p) => [p.links.github, p.links.portfolio].filter(Boolean).map((url) => ({ url })),
    labels: [[/url|website|link/i, "url"]],
  },
];

const MAX_ENTRIES = 5;
const ADD_TEXT = /^add( another)?\b/i;
const HEADINGS = "h1, h2, h3, h4, h5, h6, [role=heading]";
// Real Workday pairs each "-input" with a non-input "-display" div; only
// the input has a value to type into.
const DATE_INPUT = "input[data-automation-id^=dateSection]";

const headingsIn = (root: ParentNode, re: RegExp) =>
  deepQueryAll<HTMLElement>(root, HEADINGS).filter((h) => re.test(cleanText(h.textContent ?? "")));

// Prefers the Add whose aria-label names the section ("Add Work Experience").
function addButton(section: Element, title = ""): HTMLElement | undefined {
  const adds = deepQueryAll<HTMLElement>(section, "button, [role=button]").filter(
    (b) => isShown(b) && (ADD_TEXT.test(cleanText(b.textContent ?? "")) || ADD_TEXT.test(b.getAttribute("aria-label") ?? "")),
  );
  const named = title && adds.find((b) => (b.getAttribute("aria-label") ?? "").toLowerCase().includes(title.toLowerCase()));
  return named || adds.pop();
}

// The section is the nearest ancestor of its heading that holds an Add
// button — never one that also holds another section's heading.
function sectionOf(heading: HTMLElement, spec: SectionSpec): Element | null {
  for (let n = heading.parentElement; n; n = n.parentElement) {
    if (SECTIONS.some((o) => o !== spec && headingsIn(n!, o.heading).length)) return null;
    if (addButton(n)) return n;
  }
  return null;
}

// An entry is the largest ancestor of its "Work Experience N" heading that
// holds no other entry's heading.
function entriesOf(section: Element, re: RegExp): Element[] {
  const heads = headingsIn(section, re);
  return heads.map((h) => {
    let box: Element = h;
    while (box.parentElement && box.parentElement !== section && headingsIn(box.parentElement, re).length === 1) {
      box = box.parentElement;
    }
    return box;
  });
}

// Real Workday adds a section entry over the network (seconds, not a
// synchronous DOM insert); give it room before assuming the press failed.
const ADD_WAIT_MS = 12_000;
const FIELDS_WAIT_MS = 3_000;

// A wall-clock deadline, not an iteration count: Chrome throttles timers in
// background tabs (a 50ms sleep can take ~1s), so counting ticks would let
// a backgrounded run blow past its intended budget by an order of magnitude.
export async function waitUntil(check: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() >= deadline) return false;
    await sleep(50);
  }
  return true;
}

async function addUntil(section: Element, spec: SectionSpec, want: number): Promise<number> {
  let added = 0;
  while (entriesOf(section, spec.entry).length < want) {
    const btn = addButton(section, spec.title);
    if (!btn) break;
    const before = entriesOf(section, spec.entry).length;
    press(btn);
    if (!(await waitUntil(() => entriesOf(section, spec.entry).length > before, ADD_WAIT_MS))) break;
    added++;
  }
  return added;
}

// "2026-05" → { y: "2026", m: "05" }; "2020" → { y: "2020" }.
function splitDate(s: string): { y?: string; m?: string; d?: string } {
  const m = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  return m ? { y: m[1], m: m[2]?.padStart(2, "0"), d: m[3]?.padStart(2, "0") } : {};
}

// Month/Day/Year spinbuttons, grouped by their form-field container.
function dateGroups(root: ParentNode): { label: string; inputs: HTMLInputElement[] }[] {
  const groups = new Map<Element, HTMLInputElement[]>();
  for (const input of deepQueryAll<HTMLInputElement>(root, DATE_INPUT)) {
    const box = input.closest("[data-automation-id^='formField-'], fieldset") ?? input.parentElement!;
    groups.set(box, [...(groups.get(box) ?? []), input]);
  }
  return [...groups].map(([box, inputs]) => ({
    label: `${box.getAttribute("data-automation-id") ?? ""} ${cleanText(box.querySelector("legend, label")?.textContent ?? "")}`,
    inputs,
  }));
}

function typeDate(inputs: HTMLInputElement[], parts: { y?: string; m?: string; d?: string }): number {
  let n = 0;
  for (const input of inputs) {
    const aid = input.getAttribute("data-automation-id") ?? "";
    const v = /Month/.test(aid) ? parts.m : /Day/.test(aid) ? parts.d : /Year/.test(aid) ? parts.y : undefined;
    if (!v || input.value.trim()) continue;
    input.focus();
    typeInto(input, v);
    input.blur();
    n++;
  }
  return n;
}

// Repeating Work Experience / Education / Websites sections: press Add until
// there is one entry per profile item (max 5), then fill each entry's empty,
// untouched fields by label. Returns the entry field ids it owns so the
// generic fill leaves them alone.
export async function fillWorkdaySections(
  doc: Document,
  profile: Profile,
  isTouched: (fieldId: string) => boolean,
): Promise<{ added: number; filled: number; owned: string[] }> {
  let added = 0;
  let filled = 0;
  const owned: string[] = [];
  for (const spec of SECTIONS) {
    const items = spec.items(profile);
    for (const heading of headingsIn(doc, spec.heading)) {
      const section = sectionOf(heading, spec);
      if (!section) continue;
      // Fields but no entry we can count: pressing Add could only duplicate.
      const unrecognised =
        !entriesOf(section, spec.entry).length && extractLiveFields(section, { stamp: false }).length > 0;
      if (items.length && !unrecognised) {
        added += await addUntil(section, spec, Math.min(items.length, MAX_ENTRIES));
      }
      const entries = entriesOf(section, spec.entry);
      for (const [i, entry] of entries.entries()) {
        const item = items[i];
        // The entry's heading can commit a render ahead of its own inputs
        // (real Workday); give those a moment before reading it as empty.
        await waitUntil(() => extractLiveFields(entry, { stamp: false }).length > 0, FIELDS_WAIT_MS);
        const all = extractLiveFields(entry);
        owned.push(...all.map((f) => f.id));
        const fields = all.filter((f) => !findField(doc, f.id)?.matches(DATE_INPUT));
        if (!item) continue;
        const instructions = fields.flatMap((f) => {
          const key = spec.labels.find(([re]) => re.test(f.label))?.[1];
          let value = key ? item[key] ?? "" : "";
          if (key === "current") value = value === "true" ? "Yes" : "";
          const el = findField(doc, f.id);
          return value && el && isFieldEmpty(el) && !isTouched(f.id) ? [{ fieldId: f.id, value }] : [];
        });
        filled += (await applyFill(instructions, doc, isTouched)).filled.length;
        for (const g of dateGroups(entry)) {
          const start = /start|from|first/i.test(g.label);
          const end = !start && /end|\bto\b|last/i.test(g.label) && item.current !== "true";
          const which = start ? item.start : end ? item.end : "";
          if (which) filled += typeDate(g.inputs, splitDate(which));
        }
      }
    }
  }
  return { added, filled, owned };
}

const pad = (n: number) => String(n).padStart(2, "0");

// Self Identify pages ask for today's date next to the signature.
export function fillWorkdayDates(doc: Document, now = new Date()): number {
  let n = 0;
  for (const g of dateGroups(doc)) {
    const text = cleanText(g.label.replace(/^\S*\s/, ""));
    // Exactly "Date" / "Today's Date" — never "Date of Birth" or "Date Available".
    if (!/^(today'?s )?date\*?$/i.test(text) && !/dateSignedOn/i.test(g.label)) continue;
    n += typeDate(g.inputs, { y: String(now.getFullYear()), m: pad(now.getMonth() + 1), d: pad(now.getDate()) });
  }
  return n;
}
