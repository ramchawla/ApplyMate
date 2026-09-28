import { detect } from "./detectors/index";
import { extractJD } from "./extractors/index";
import { extractLiveFields } from "./extractors/form";
import { applyFill, attachFile, findField, highlightEmptyRequired } from "./fill";
import { mountWidget, type WidgetState } from "./widget";
import { sleep } from "./dom";
import { buildInstantPlan } from "../lib/field-mapping";
import { normalizeProfile } from "../utils/profile";
import { pickJD, rememberJD, type CachedJD, type PageJD } from "../lib/jd-cache";
import type { FormField, Profile, RunReport, TailorResult } from "../types";

export function isApplicationForm(fields: FormField[]): boolean {
  const hasResume = fields.some((f) => f.type === "file" && f.extractedValueType === "resume");
  const hasEmail = fields.some((f) => f.extractedValueType === "email");
  return hasResume || (hasEmail && fields.length >= 4);
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
  fields: FormField[];
  jd: PageJD;
  jdSource: string;
  keywords: string[];
  send: Send;
  onStatus: (lines: Line[]) => void;
  pollMs?: number;
  settleMs?: number;
}

const POLL_LIMIT_MS = 240_000;

function base64ToFile(b64: string, name: string): File {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: "application/pdf" });
}

export async function runOneClick(ctx: OneClickContext): Promise<RunReport> {
  const { doc, fields, send } = ctx;
  const lines: Line[] = [];
  const status = (line: Line, replaceTone?: Line["tone"]) => {
    if (replaceTone) {
      const i = lines.findIndex((l) => l.tone === replaceTone);
      if (i !== -1) lines.splice(i, 1);
    }
    lines.push(line);
    ctx.onStatus([...lines]);
  };

  // Phase 1 — instant fill from the profile.
  const profileRes = await send({ type: "GET_PROFILE" });
  const profile: Profile = normalizeProfile(profileRes?.error ? {} : profileRes);
  const plan = buildInstantPlan(fields, profile);
  const first = await applyFill(plan.instructions, doc);
  status({ tone: "ok", text: `${first.filled.length} fields filled` });

  const report: RunReport = {
    url: ctx.jd.url,
    title: ctx.jd.title,
    company: ctx.jd.company,
    jdSource: ctx.jdSource,
    filled: first.filled.length,
    needsYou: [],
    at: Date.now(),
  };

  // Phase 2 — tailor in the background.
  const coverField = fields.find((f) => f.extractedValueType === "cover-letter");
  const start = await send({
    type: "TAILOR_START",
    request: {
      job: {
        title: ctx.jd.title,
        company: ctx.jd.company,
        url: ctx.jd.url,
        description: ctx.jd.description,
      },
      keywords: ctx.keywords,
      fields: plan.pending
        .filter((f) => f.extractedValueType !== "cover-letter")
        .map((f) => ({
          fieldId: f.id,
          label: (f.description ? `${f.label} — ${f.description}` : f.label).slice(0, 500),
          type: f.type,
          options: f.options,
          required: f.required,
        })),
      wantCoverLetterPdf: coverField?.type === "file",
    },
  });

  let result: TailorResult | undefined;
  if (!start?.jobId) {
    report.error = `Bridge offline or failed (${start?.error ?? profileRes?.error ?? "no response"}) — start it with \`pnpm bridge\``;
    status({ tone: "err", text: report.error });
  } else {
    const began = Date.now();
    for (;;) {
      await sleep(ctx.pollMs ?? 2000);
      const s = await send({ type: "TAILOR_POLL", jobId: start.jobId });
      if (s?.status === "done") {
        result = s.result as TailorResult;
        break;
      }
      if (s?.status === "error" || s?.error || Date.now() - began > POLL_LIMIT_MS) {
        report.error = `Tailoring failed: ${s?.error ?? "timed out"}`;
        status({ tone: "err", text: report.error }, "wait");
        break;
      }
      status(
        { tone: "wait", text: `Tailoring resume… ${Math.round((Date.now() - began) / 1000)}s` },
        "wait",
      );
    }
  }

  if (result) {
    report.result = result;
    // Prefer the labelled Resume field over unlabelled "autofill from
    // resume" drop zones (Ashby), which re-parse and overwrite the form.
    const resumeFields = fields.filter((f) => f.type === "file" && f.extractedValueType === "resume");
    const resumeField =
      resumeFields.find((f) => /resume|cv|curriculum/i.test(f.label)) ?? resumeFields[0];
    const resumeInput = resumeField
      ? (findField(doc, resumeField.id) as HTMLInputElement | null)
      : null;
    let attached = false;
    if (resumeInput) {
      const pdf = await send({ type: "FETCH_PDF", jobId: start.jobId, kind: "resume" });
      if (pdf?.base64) attached = attachFile(resumeInput, base64ToFile(pdf.base64, result.fileName));
    }
    if (coverField?.type === "file" && result.hasCoverLetterPdf) {
      const input = findField(doc, coverField.id) as HTMLInputElement | null;
      const pdf = await send({ type: "FETCH_PDF", jobId: start.jobId, kind: "cover-letter" });
      if (input && pdf?.base64) {
        attachFile(
          input,
          base64ToFile(pdf.base64, result.fileName.replace(/\.pdf$/, "_Cover_Letter.pdf")),
        );
      }
    }

    // Resume parsers (Lever, Ashby) overwrite fields on upload — let them
    // finish, then re-apply the profile values and Claude's answers.
    await sleep(ctx.settleMs ?? 1500);
    await applyFill(plan.instructions, doc);
    const answers = [...result.answers];
    if (coverField && coverField.type !== "file" && result.coverLetter) {
      answers.push({ fieldId: coverField.id, value: result.coverLetter });
    }
    const second = await applyFill(answers, doc);

    status(
      {
        tone: "ok",
        text: `${attached ? `PDF attached (${result.pages} page)` : "PDF ready (attach manually)"} · ${second.filled.length} answers drafted`,
      },
      "wait",
    );
    if (result.warnings.length) {
      status({ tone: "warn", text: `${result.warnings.length} things to double-check (Details)` });
    }
  }

  report.needsYou = highlightEmptyRequired(doc, fields);
  if (report.needsYou.length) {
    status({ tone: "warn", text: `${report.needsYou.length} required fields need you` });
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
  const last: { jobId?: string; result?: TailorResult } = {};
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

  async function currentJD() {
    const cache = await storageGet<Record<string, CachedJD>>("jdCache", {});
    const overrides = await storageGet<Record<string, string>>("jdOverrides", {});
    return pickJD(page, { cache, overrides }, Date.now(), ignoreRecent);
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
    const isForm = isApplicationForm(fields);
    if (!isForm && !posting) return;
    const { jd, source } = await currentJD();
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
        send: async (msg: unknown) => {
          const res = await send(msg);
          if ((msg as { type?: string })?.type === "TAILOR_START" && res?.jobId) {
            last.jobId = res.jobId;
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
