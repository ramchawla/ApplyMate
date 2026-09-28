import { detect } from "./detectors/index";
import { extractJD } from "./extractors/index";
import { extractLiveFields } from "./extractors/form";
import { applyFill, attachFile, findField, highlightEmptyRequired } from "./fill";
import { mountWidget, type WidgetState } from "./widget";
import { FIELD_ATTR, press, sleep } from "./dom";
import { fillWorkdayDates, fillWorkdaySections, isWorkday } from "./adapters/workday";
import { activeScope, findStepButton, stepSignature, visibleErrors, waitForStepChange } from "./wizard";
import { buildInstantPlan } from "../lib/field-mapping";
import { normalizeProfile } from "../utils/profile";
import { pickJD, rememberJD, type CachedJD, type PageJD } from "../lib/jd-cache";
import type { FormField, Profile, RunReport, TailorResult } from "../types";

// A resume upload is the strongest signal. Otherwise require that we know
// this is a job (posting detected or JD cached) — contact, checkout and
// signup forms also have email + a few fields.
export function isApplicationForm(fields: FormField[], jobKnown: boolean): boolean {
  const hasResume = fields.some((f) => f.type === "file" && f.extractedValueType === "resume");
  const hasEmail = fields.some((f) => f.extractedValueType === "email");
  return hasResume || (jobKnown && hasEmail && fields.length >= 4);
}

const SUBMIT_TEXT = /^(submit( my)?( application)?|send application|apply|apply now|finish)$/i;

export function isSubmitControl(el: Element): boolean {
  const btn = el.closest("button, input[type=submit], [role=button]") as HTMLElement | null;
  if (!btn) return false;
  const text = (btn.textContent || (btn as HTMLInputElement).value || "")
    .replace(/\s+/g, " ")
    .trim();
  return SUBMIT_TEXT.test(text);
}

export function isPostingPage(board: string, confidence: number): boolean {
  if (board === "unknown") return false;
  return board !== "generic" || confidence >= 0.75;
}

type Line = WidgetState["lines"][number];
// Messages to the background worker; responses are loosely typed JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Send = (msg: unknown) => Promise<any>;

export interface OneClickContext {
  doc: Document;
  // Step 1's fields (already scanned); later steps are rescanned.
  fields: FormField[];
  jd: PageJD;
  jdSource: string;
  keywords: string[];
  send: Send;
  onStatus: (lines: Line[]) => void;
  pollMs?: number;
  settleMs?: number;
  stepTimeoutMs?: number;
  // Resuming after a pause: poll this finished/running job, don't start one.
  tailorJobId?: string;
  // Fields the user edited, kept across runs so a resume never overwrites them.
  touched?: Set<string>;
  // Which events count as the user editing a field (tests inject a stub;
  // synthetic events from our own fills are never trusted).
  isUserEvent?: (e: Event) => boolean;
}

const POLL_LIMIT_MS = 240_000;
const MAX_STEPS = 15;

function base64ToFile(b64: string, name: string): File {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: "application/pdf" });
}

export function trackUserEdits(
  doc: Document,
  touched: Set<string>,
  isUserEvent: (e: Event) => boolean,
): () => void {
  const onEdit = (e: Event) => {
    if (!isUserEvent(e) || !(e.target instanceof Element)) return;
    const id = e.target.closest(`[${FIELD_ATTR}]`)?.getAttribute(FIELD_ATTR);
    if (id) touched.add(id);
  };
  doc.addEventListener("input", onEdit, true);
  doc.addEventListener("change", onEdit, true);
  return () => {
    doc.removeEventListener("input", onEdit, true);
    doc.removeEventListener("change", onEdit, true);
  };
}

export async function runOneClick(ctx: OneClickContext): Promise<RunReport> {
  // Anything the user edits during the run is theirs: never overwritten.
  const touched = ctx.touched ?? new Set<string>();
  const stop = trackUserEdits(ctx.doc, touched, ctx.isUserEvent ?? ((e: Event) => e.isTrusted));
  try {
    return await runSteps(ctx, touched);
  } finally {
    stop();
  }
}

const scopeRoot = (doc: Document) => {
  const scope = activeScope(doc);
  return scope instanceof Document ? scope : (scope as Element);
};

const toQuestion = (f: FormField) => ({
  fieldId: f.id,
  label: (f.description ? `${f.label} — ${f.description}` : f.label).slice(0, 500),
  type: f.type,
  options: f.options,
  required: f.required,
});

// One press fills the page; on a wizard (Next/Continue on step 1) it fills
// each step, presses Next, and stops at the page whose button is Submit —
// never pressing it. Pauses on empty required fields or rejected steps.
async function runSteps(ctx: OneClickContext, touched: Set<string>): Promise<RunReport> {
  const { doc, send } = ctx;
  const lines: Line[] = [];
  const status = (line: Line, replaceTone?: Line["tone"]) => {
    if (replaceTone) {
      const i = lines.findIndex((l) => l.tone === replaceTone);
      if (i !== -1) lines.splice(i, 1);
    }
    lines.push(line);
    ctx.onStatus([...lines]);
  };
  const untouched = (i: { fieldId: string }) => !touched.has(i.fieldId);
  const job = {
    title: ctx.jd.title,
    company: ctx.jd.company,
    url: ctx.jd.url,
    description: ctx.jd.description,
  };

  const profileRes = await send({ type: "GET_PROFILE" });
  const profile: Profile = normalizeProfile(profileRes?.error ? {} : profileRes);
  const report: RunReport = {
    url: ctx.jd.url,
    title: ctx.jd.title,
    company: ctx.jd.company,
    jdSource: ctx.jdSource,
    filled: 0,
    needsYou: [],
    steps: 0,
    stoppedAt: "done",
    at: Date.now(),
  };

  // Polls a bridge job until it settles; resolves the done response or null.
  const poll = async (type: string, jobId: string, what: string) => {
    const began = Date.now();
    for (;;) {
      await sleep(ctx.pollMs ?? 2000);
      const s = await send({ type, jobId });
      if (s?.status === "done") return s;
      if (s?.status === "error" || s?.error || Date.now() - began > POLL_LIMIT_MS) {
        report.error = `${what} failed: ${s?.error ?? "timed out"}`;
        status({ tone: "err", text: report.error }, "wait");
        return null;
      }
      status({ tone: "wait", text: `${what}… ${Math.round((Date.now() - began) / 1000)}s` }, "wait");
    }
  };

  let tailorJobId = ctx.tailorJobId;
  let result: TailorResult | undefined;
  let tailorAwaited = false;
  const awaitTailoring = async () => {
    if (!tailorAwaited && tailorJobId) {
      tailorAwaited = true;
      result = (await poll("TAILOR_POLL", tailorJobId, "Tailoring resume"))?.result;
      if (result) report.result = result;
    }
    return result;
  };

  let wizard = false;
  for (let step = 1; step <= MAX_STEPS; step++) {
    report.steps = step;
    let fields = step === 1 ? ctx.fields : extractLiveFields(scopeRoot(doc));
    // Workday: repeating sections (one entry per profile job/school) and
    // the self-identify date. Their fields are the adapter's, not the
    // instant fill's ("Job Title" would get the current title everywhere).
    let owned = new Set<string>();
    let adapterFilled = 0;
    if (isWorkday(doc)) {
      const wd = await fillWorkdaySections(doc, profile, (id) => touched.has(id));
      adapterFilled = wd.filled + fillWorkdayDates(doc);
      owned = new Set(wd.owned);
      if (wd.added) fields = extractLiveFields(scopeRoot(doc));
    }
    const plan = buildInstantPlan(fields.filter((f) => !owned.has(f.id)), profile);
    const first = await applyFill(plan.instructions.filter(untouched), doc);
    const filledHere = first.filled.length + adapterFilled;
    report.filled += filledHere;

    const coverField = fields.find((f) => f.extractedValueType === "cover-letter");
    const questions = plan.pending.filter((f) => f !== coverField);
    if (step === 1) {
      wizard = findStepButton(doc)?.kind === "advance";
      status({ tone: "ok", text: `${wizard ? "Step 1 · " : ""}${filledHere} fields filled` });
      if (!tailorJobId) {
        // Single page: one call tailors and answers. Wizard: answers come
        // per step from /answer so step 1 needn't wait for the resume.
        const start = await send({
          type: "TAILOR_START",
          request: {
            job,
            keywords: ctx.keywords,
            fields: wizard ? [] : questions.map(toQuestion),
            wantCoverLetterPdf: coverField?.type === "file",
          },
        });
        tailorJobId = start?.jobId;
        if (!tailorJobId) {
          report.error = `Bridge offline or failed (${start?.error ?? profileRes?.error ?? "no response"}) — start it with \`pnpm bridge\``;
          status({ tone: "err", text: report.error });
        }
      }
    } else {
      status({ tone: "ok", text: `Step ${step} · ${filledHere} fields filled` }, "ok");
    }

    // Prefer the labelled Resume field over unlabelled "autofill from
    // resume" drop zones (Ashby), which re-parse and overwrite the form.
    const resumeFields = fields.filter((f) => f.type === "file" && f.extractedValueType === "resume");
    const resumeField =
      resumeFields.find((f) => /resume|cv|curriculum/i.test(f.label)) ?? resumeFields[0];
    const answers: { fieldId: string; value: string }[] = [];
    let attachedNote = "";
    if (!wizard || resumeField || coverField) {
      await awaitTailoring();
      const root = scopeRoot(doc);
      const shown = (root instanceof Document ? root.documentElement : root).textContent ?? "";
      if (result && tailorJobId && resumeField && !shown.includes(result.fileName)) {
        const input = findField(doc, resumeField.id) as HTMLInputElement | null;
        const pdf = input ? await send({ type: "FETCH_PDF", jobId: tailorJobId, kind: "resume" }) : null;
        const ok = !!pdf?.base64 && attachFile(input!, base64ToFile(pdf.base64, result.fileName));
        attachedNote = ok ? `PDF attached (${result.pages} page)` : "PDF ready (attach manually)";
      }
      if (result && tailorJobId && coverField?.type === "file" && result.hasCoverLetterPdf) {
        const input = findField(doc, coverField.id) as HTMLInputElement | null;
        const pdf = await send({ type: "FETCH_PDF", jobId: tailorJobId, kind: "cover-letter" });
        if (input && pdf?.base64) {
          attachFile(input, base64ToFile(pdf.base64, result.fileName.replace(/\.pdf$/, "_Cover_Letter.pdf")));
        }
      }
      if (result && coverField && coverField.type !== "file" && result.coverLetter) {
        answers.push({ fieldId: coverField.id, value: result.coverLetter });
      }
      if (result && !wizard) answers.push(...result.answers);
      if (result && (resumeField || coverField)) {
        // Resume parsers (Lever, Ashby, Workday) overwrite fields on upload —
        // let them finish, then re-apply the profile values.
        await sleep(ctx.settleMs ?? 1500);
        await applyFill(plan.instructions.filter(untouched), doc);
      }
    }
    if (wizard && questions.length) {
      const start = await send({ type: "ANSWER_START", request: { job, fields: questions.map(toQuestion) } });
      const done = start?.jobId ? await poll("ANSWER_POLL", start.jobId, "Drafting answers") : null;
      if (Array.isArray(done?.answers)) answers.push(...done.answers);
    }
    const second = await applyFill(answers.filter(untouched), doc);
    if (attachedNote || second.filled.length) {
      status({ tone: "ok", text: [attachedNote, `${second.filled.length} answers drafted`].filter(Boolean).join(" · ") }, "wait");
    }
    if (result?.warnings.length && step === 1 && !wizard) {
      status({ tone: "warn", text: `${result.warnings.length} things to double-check (Details)` });
    }

    report.needsYou = highlightEmptyRequired(doc, fields);
    if (wizard && resumeField && !result) report.needsYou.push(resumeField.id);
    if (report.needsYou.length) {
      report.stoppedAt = "needs-you";
      status({ tone: "warn", text: `${report.needsYou.length} required fields need you` });
      break;
    }

    const button = findStepButton(doc);
    if (!button) {
      report.stoppedAt = step === 1 ? "no-button" : "done";
      break;
    }
    if (button.kind === "submit") {
      report.stoppedAt = "review";
      status({ tone: "ok", text: "Ready for review — check everything, then click Submit" });
      break;
    }
    const before = stepSignature(doc);
    press(button.el);
    if (!(await waitForStepChange(doc, before, ctx.stepTimeoutMs))) {
      report.stoppedAt = "errors";
      report.errors = visibleErrors(doc);
      status({ tone: "warn", text: report.errors.length ? `Step rejected: ${report.errors.join("; ")}` : "Step didn't advance — check the page" });
      break;
    }
    if (step === MAX_STEPS) report.stoppedAt = "max-steps";
  }

  await send({ type: "RUN_REPORT", report });
  return report;
}

// Re-scan only when form controls appear — cheap on pages that churn DOM
// constantly (LinkedIn feed) but never add inputs.
const REEXTRACT_DEBOUNCE_MS = 400;

export function watchForInjectedFields(
  doc: Document,
  onFieldsChanged: () => void,
): MutationObserver {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver((mutations) => {
    const addedFormControls = mutations.some((m) =>
      Array.from(m.addedNodes).some(
        (node) =>
          node instanceof Element &&
          !node.hasAttribute("data-applymate-widget") &&
          (node.matches("input, textarea, select, form, [role=combobox], [role=radiogroup]") ||
            node.querySelector?.("input, textarea, select") !== null),
      ),
    );
    if (!addedFormControls) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(onFieldsChanged, REEXTRACT_DEBOUNCE_MS);
  });
  // documentElement, not body: hydration recovery can swap <body> out.
  observer.observe(doc.documentElement, { childList: true, subtree: true });
  doc.defaultView?.addEventListener("pagehide", () => {
    if (timer !== undefined) clearTimeout(timer);
    observer.disconnect();
  });
  return observer;
}

// ---------------------------------------------------------------------------
// Live wiring — only inside a real extension context.

const inExtension =
  typeof chrome !== "undefined" &&
  !!chrome.runtime &&
  !!(chrome.runtime as { onMessage?: unknown }).onMessage;

const SEND_TIMEOUT_MS = 20_000;
const HYDRATION_GRACE_MS = 1000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function send(msg: unknown): Promise<any> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ error: "extension background did not respond" }), SEND_TIMEOUT_MS);
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        clearTimeout(timer);
        const lastError = chrome.runtime.lastError?.message;
        resolve(res ?? { error: lastError ?? "no response" });
      });
    } catch (err) {
      resolve({ error: String(err) });
    }
  });
}

function storageGet<T>(key: string, fallback: T): Promise<T> {
  return new Promise((resolve) =>
    chrome.storage.local.get(key, (r) => resolve((r[key] as T) ?? fallback)),
  );
}
function storageSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set(items, () => resolve()));
}

async function main(): Promise<void> {
  const isTop = window.top === window;
  let widget: ReturnType<typeof mountWidget> | null = null;
  let fields: FormField[] = [];
  let page: PageJD = { url: location.href, title: "", company: "", description: "" };
  let posting = false;
  let ignoreRecent = false;
  let ranFill = false;
  const last: { jobId?: string; jobUrl?: string; result?: TailorResult } = {};
  // Edits the user makes between runs count too: resuming a paused wizard
  // must not overwrite them.
  const touched = new Set<string>();
  trackUserEdits(document, touched, (e) => e.isTrusted);
  const ui: WidgetState = {
    mode: "form",
    title: "",
    company: "",
    jdSource: "none",
    keywords: await storageGet<string[]>("keywords", []),
    busy: false,
    lines: [],
    injected: [],
    skipped: [],
    collapsed: false,
    canOpenPdf: false,
  };

  const tabKey: string = isTop ? "" : ((await send({ type: "TAB_JOB_KEY" }))?.key ?? "");
  async function currentJD() {
    const cache = await storageGet<Record<string, CachedJD>>("jdCache", {});
    const overrides = await storageGet<Record<string, string>>("jdOverrides", {});
    return pickJD(page, { cache, overrides }, Date.now(), ignoreRecent, tabKey || undefined);
  }

  async function refresh(readJD: boolean): Promise<void> {
    if (readJD) {
      const html = document.documentElement.outerHTML;
      const detection = detect({ url: location.href, html });
      posting = isTop && isPostingPage(detection.board, detection.confidence);
      const extracted = posting
        ? extractJD(html, detection.board)
        : { jobTitle: "", company: "", jobDescription: "" };
      page = {
        url: location.href,
        title: extracted.jobTitle,
        company: extracted.company,
        description: extracted.jobDescription,
      };
      if (posting && page.description.length >= 200) {
        const cache = await storageGet<Record<string, CachedJD>>("jdCache", {});
        await storageSet({ jdCache: rememberJD(cache, page, Date.now()) });
      }
    }
    fields = extractLiveFields(document, { stamp: false });
    const { jd, source } = await currentJD();
    const isForm = isApplicationForm(fields, posting || (source !== "none" && source !== "recent"));
    if (!isForm && !posting) return;
    Object.assign(ui, {
      mode: isForm ? "form" : "posting",
      title: jd.title,
      company: jd.company,
      jdSource: source,
    });
    widget ??= mountWidget(document, handlers, isTop ? "bottom" : "top");
    widget.render(ui);
  }

  const handlers = {
    onRun: async () => {
      if (ui.busy) return;
      Object.assign(ui, { busy: true, lines: [], injected: [], skipped: [], canOpenPdf: false });
      widget?.render(ui);
      fields = extractLiveFields(document);
      const { jd, source } = await currentJD();
      ranFill = true;
      let report: RunReport;
      try {
        report = await runOneClick({
        doc: document,
        fields,
        jd,
        jdSource: source,
        keywords: ui.keywords,
        touched,
        // Same job as a paused run: reuse its tailoring instead of re-running Claude.
        tailorJobId: last.jobUrl === jd.url ? last.jobId : undefined,
        send: async (msg: unknown) => {
          const res = await send(msg);
          if ((msg as { type?: string })?.type === "TAILOR_START" && res?.jobId) {
            Object.assign(last, { jobId: res.jobId, jobUrl: jd.url });
          }
          return res;
        },
        onStatus: (lines) => {
          ui.lines = lines;
          widget?.render(ui);
        },
      });
      } catch (err) {
        ui.busy = false;
        ui.lines = [...ui.lines, { tone: "err", text: `ApplyMate error: ${String((err as Error)?.message ?? err)}` }];
        widget?.render(ui);
        return;
      }
      last.result = report.result;
      Object.assign(ui, {
        busy: false,
        canOpenPdf: !!report.result,
        injected: report.result?.keywords.injected.map((k) => k.keyword) ?? [],
        skipped: report.result?.keywords.skipped ?? [],
      });
      widget?.render(ui);
    },
    onKeywordsChange: async (keywords: string[]) => {
      ui.keywords = keywords;
      await storageSet({ keywords });
      widget?.render(ui);
    },
    onDismissJD: async () => {
      ignoreRecent = true;
      await refresh(false);
    },
    onOpenPdf: async () => {
      if (!last.jobId) return;
      const pdf = await send({ type: "FETCH_PDF", jobId: last.jobId, kind: "resume" });
      if (pdf?.base64) {
        window.open(
          URL.createObjectURL(base64ToFile(pdf.base64, last.result?.fileName ?? "resume.pdf")),
        );
      }
    },
    onDetails: () => void send({ type: "OPEN_SIDE_PANEL" }),
    onToggle: () => {
      ui.collapsed = !ui.collapsed;
      widget?.render(ui);
    },
  };

  // The user's own submit click marks the application applied (never ours).
  document.addEventListener(
    "click",
    (e) => {
      if (!ranFill || !(e.target instanceof Element) || !isSubmitControl(e.target)) return;
      ranFill = false;
      void send({ type: "MARK_APPLIED", jobUrl: page.url, company: ui.company, jobTitle: ui.title });
    },
    true,
  );

  // Wizards (Workday, LinkedIn Easy Apply, Ashby) inject fields later; SPAs
  // change the job without a page load.
  watchForInjectedFields(document, () => void refresh(false));
  let lastUrl = location.href;
  setInterval(() => {
    widget?.ensureAttached();
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    void refresh(true);
  }, 1000);

  // Touch nothing until the page has loaded and hydrated: React treats nodes
  // added before hydration as a mismatch and re-renders the whole document.
  if (document.readyState !== "complete") {
    await new Promise((r) => window.addEventListener("load", r, { once: true }));
  }
  await sleep(HYDRATION_GRACE_MS);
  await refresh(true);
}

if (inExtension && typeof document !== "undefined" && document.body) {
  main().catch((err: unknown) => {
    // Content-script errors never reach the page console reliably; leave a
    // trace a developer (or an automated check) can read from the page.
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error("[ApplyMate] init failed:", err);
    document.documentElement.setAttribute("data-applymate-error", message.slice(0, 300));
  });
}
