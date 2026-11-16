import { cleanText, deepQueryAll } from "./dom";
import { extractLiveFields } from "./extractors/form";

export type StepButton = { el: HTMLElement; kind: "advance" | "submit" };

const SUBMIT_TEXT = /^(submit( my)?( application)?|send application|apply|apply now|finish)$/i;
const SUBMIT_ARIA = /submit( your)? application/i;
const ADVANCE_TEXT =
  /^(next|next step|continue|save (and|&) continue|review( your application)?|proceed)$/i;
const ADVANCE_ARIA = /continue to next step|review your application/i;
// Never pressed as "advance", whatever else matches (automation ids stay
// "next-button" on some review pages).
const SUBMITTISH = /submit|send|apply|finish|confirm|complete/i;

// Visible and usable. Real browsers: checkVisibility; jsdom: inline styles.
export function isShown(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return false;
  const check = (el as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility;
  if (typeof check === "function" && el.ownerDocument.defaultView) return check.call(el);
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    if (n.style.display === "none" || n.style.visibility === "hidden" || n.hidden) return false;
  }
  return true;
}

// A dialog's accessible name plus its first heading.
export function dialogName(dlg: Element): string {
  const root = dlg.getRootNode() as Document | ShadowRoot;
  const labelled = (dlg.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .map((id) => (id && root.getElementById?.(id)?.textContent) || "");
  const heading = dlg.querySelector("h1, h2, h3")?.textContent ?? "";
  return cleanText([dlg.getAttribute("aria-label") ?? "", ...labelled, heading].join(" "));
}

// LinkedIn Easy Apply and similar. Counts even on a step with no fields
// (review), so the scope never falls back to the page's own search boxes.
export function isApplyDialog(dlg: Element): boolean {
  return /\bappl(y|ication)\b/i.test(dialogName(dlg)) || /jobs-easy-apply/.test(dlg.className);
}

// Sign-in and account pages are the user's: a visible password box or a
// sign-in/create-account heading.
export function isSignInStep(scope: ParentNode): boolean {
  return (
    deepQueryAll<HTMLElement>(scope, "input[type=password]").some(isShown) ||
    deepQueryAll<HTMLElement>(scope, "h1, h2, h3, [role=heading]").some(
      (h) => isShown(h) && /\b(sign in|log in|create (an )?account|sign up)\b/i.test(h.textContent ?? ""),
    )
  );
}

// The open application dialog (LinkedIn Easy Apply modal) if any, else the
// page. Cookie/consent dialogs and button-only notices never count.
export function activeScope(doc: Document): ParentNode {
  const dialogs = deepQueryAll<HTMLElement>(doc, "[role=dialog], dialog[open]").filter(
    (d) =>
      isShown(d) &&
      (isApplyDialog(d) || d.querySelector("input, textarea, select")) &&
      !/cookie|consent|privacy/i.test(dialogName(d)),
  );
  return dialogs[dialogs.length - 1] ?? doc;
}

const buttonText = (b: HTMLElement) =>
  cleanText(b.textContent || (b as HTMLInputElement).value || b.getAttribute("aria-label") || "");

// Submit wins: a page with both Back and "Submit application" is the review
// page — stop there. Never returns Back/Cancel.
export function findStepButton(doc: Document): StepButton | null {
  const buttons = deepQueryAll<HTMLElement>(
    activeScope(doc),
    "button, input[type=submit], [role=button]",
  ).filter(isShown);
  const aria = (b: HTMLElement) => b.getAttribute("aria-label") ?? "";
  const submit = buttons.find((b) => SUBMIT_TEXT.test(buttonText(b)) || SUBMIT_ARIA.test(aria(b)));
  if (submit) return { el: submit, kind: "submit" };
  // Recognised by text or aria-label only: an unrecognised label (another
  // language, "Confirm and submit") is as likely to be Submit — stop instead.
  const advance = buttons.find(
    (b) =>
      (ADVANCE_TEXT.test(buttonText(b)) || ADVANCE_ARIA.test(aria(b))) &&
      !SUBMITTISH.test(`${b.textContent ?? ""} ${aria(b)} ${(b as HTMLInputElement).value ?? ""}`),
  );
  return advance ? { el: advance, kind: "advance" } : null;
}

// What identifies "this step": its visible question labels plus the first
// heading. Changes when the wizard moves on.
export function stepSignature(doc: Document): string {
  const scope = activeScope(doc);
  const heading = deepQueryAll<HTMLElement>(scope, "h1, h2, h3").find(isShown)?.textContent ?? "";
  const root = scope instanceof Document ? scope : (scope as Element);
  const labels = extractLiveFields(root, { stamp: false }).map((f) => f.label);
  return `${cleanText(heading)}|${labels.join("|")}`;
}

// Resolves true once the step's signature differs from `before` and the DOM
// has been quiet for a moment; false after `ms`.
export function waitForStepChange(doc: Document, before: string, ms = 12_000): Promise<boolean> {
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const done = (changed: boolean) => {
      observer.disconnect();
      clearTimeout(quiet);
      clearTimeout(cap);
      resolve(changed);
    };
    const settle = () => {
      clearTimeout(quiet);
      quiet = setTimeout(() => {
        if (stepSignature(doc) !== before) done(true);
      }, 300);
    };
    const observer = new MutationObserver(settle);
    const cap = setTimeout(() => done(false), ms);
    observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true });
    // The press may already have re-rendered synchronously.
    settle();
  });
}

const ERROR_SELECTOR =
  "[role=alert], [data-automation-id=errorMessage], [class*='error-message'], [class*='errorMessage']";

// Messages a wizard shows when Next is rejected. aria-invalid fields report
// their label.
export function visibleErrors(doc: Document): string[] {
  const scope = activeScope(doc);
  const out: string[] = [];
  for (const el of deepQueryAll<HTMLElement>(scope, `${ERROR_SELECTOR}, [aria-invalid=true]`)) {
    if (!isShown(el)) continue;
    let text = "";
    if (el.getAttribute("aria-invalid") === "true") {
      const root = el.getRootNode() as Document | ShadowRoot;
      text = (el.id && root.querySelector(`label[for="${el.id}"]`)?.textContent) || el.getAttribute("aria-label") || "";
    } else {
      text = el.textContent ?? "";
    }
    text = cleanText(text);
    if (text && !out.includes(text)) out.push(text);
    if (out.length === 5) break;
  }
  return out;
}

// The current form's root: the open application dialog if any, else the page.
export const scopeRoot = (doc: Document) => {
  const scope = activeScope(doc);
  return scope instanceof Document ? scope : (scope as Element);
};
