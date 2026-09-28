import type { JDSource } from "../lib/jd-cache";

export interface WidgetState {
  mode: "form" | "posting";
  title: string;
  company: string;
  jdSource: JDSource | string;
  keywords: string[];
  busy: boolean;
  lines: { tone: "ok" | "wait" | "warn" | "err"; text: string }[];
  injected: string[];
  skipped: { keyword: string; reason: string }[];
  collapsed: boolean;
  canOpenPdf: boolean;
}

export interface WidgetHandlers {
  onRun(): void;
  onKeywordsChange(keywords: string[]): void;
  onDismissJD(): void;
  onOpenPdf(): void;
  onDetails(): void;
  onToggle(): void;
}

// Everything rendered below is page- or Claude-controlled text; it all goes
// through this before reaching innerHTML.
export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

const ICON = { ok: "✓", wait: "⏳", warn: "⚠", err: "✗" } as const;
const JD_LABEL: Record<string, string> = {
  override: "pasted",
  page: "this page",
  cached: "from posting",
  recent: "recent",
  none: "none — using keywords",
};

const CSS = `
:host { all: initial; }
.card { position: fixed; right: 16px; z-index: 2147483647; width: 300px; font: 13px/1.4 system-ui, sans-serif;
  color: #111827; background: #fff; border: 1px solid #e5e7eb; border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0,0,0,.15); padding: 12px; }
.bottom { bottom: 16px; } .top { top: 16px; }
.head { display: flex; justify-content: space-between; align-items: center; font-weight: 600; margin-bottom: 6px; }
.muted { color: #6b7280; font-size: 12px; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
.chip { background: #eef2ff; color: #3730a3; border-radius: 999px; padding: 2px 8px; font-size: 12px; }
.chip button, .x { background: none; border: 0; cursor: pointer; color: inherit; padding: 0 0 0 4px; font: inherit; }
.ok { background: #dcfce7; color: #166534; } .no { background: #f3f4f6; color: #6b7280; }
input { width: 100%; box-sizing: border-box; border: 1px solid #d1d5db; border-radius: 6px; padding: 4px 6px; font: inherit; }
.run { width: 100%; margin: 8px 0 4px; padding: 8px; border: 0; border-radius: 8px; background: #4f46e5; color: #fff;
  font-weight: 600; cursor: pointer; font-size: 14px; }
.run:disabled { background: #a5b4fc; cursor: default; }
.line { margin: 2px 0; } .warn { color: #b45309; } .err { color: #b91c1c; }
.links { display: flex; gap: 10px; margin-top: 6px; }
.links button { background: none; border: 0; color: #4f46e5; cursor: pointer; padding: 0; font: inherit; }
.pill { padding: 6px 10px; width: auto; }
`;

export function mountWidget(
  doc: Document,
  handlers: WidgetHandlers,
  placement: "bottom" | "top",
) {
  const host = doc.createElement("div");
  host.setAttribute("data-applymate-widget", "");
  const root = host.attachShadow({ mode: "open" });
  doc.body.appendChild(host);
  let state: WidgetState | null = null;

  const addKeywords = (input: HTMLInputElement) => {
    if (!state) return;
    const fresh = input.value
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    input.value = "";
    const next = [...state.keywords];
    for (const k of fresh) {
      if (!next.some((x) => x.toLowerCase() === k.toLowerCase())) next.push(k);
    }
    handlers.onKeywordsChange(next);
  };

  root.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const remove = t.closest("[data-remove]")?.getAttribute("data-remove");
    if (remove != null && state) {
      handlers.onKeywordsChange(state.keywords.filter((k) => k !== remove));
      return;
    }
    const action = t.closest("[data-action]")?.getAttribute("data-action");
    if (action === "run") handlers.onRun();
    else if (action === "dismiss-jd") handlers.onDismissJD();
    else if (action === "pdf") handlers.onOpenPdf();
    else if (action === "details") handlers.onDetails();
    else if (action === "toggle") handlers.onToggle();
  });
  root.addEventListener("keydown", (e) => {
    const t = e.target as HTMLInputElement;
    const key = (e as KeyboardEvent).key;
    if (t.dataset?.role === "kw" && (key === "Enter" || key === ",")) {
      e.preventDefault();
      addKeywords(t);
    }
    e.stopPropagation(); // keep site shortcuts from eating keystrokes
  });

  function render(s: WidgetState): void {
    state = s;
    const kwInput = root.querySelector<HTMLInputElement>("input[data-role=kw]");
    const draft = kwInput?.value ?? "";
    const hadFocus = !!kwInput && root.activeElement === kwInput;
    const job =
      [s.title, s.company].filter(Boolean).map(escapeHtml).join(" · ") || "Job application";

    if (s.mode === "posting") {
      root.innerHTML = `<style>${CSS}</style><div class="card pill ${placement}">
        <span class="muted">ApplyMate · JD saved ✓ ${escapeHtml(s.title)}</span></div>`;
      return;
    }
    if (s.collapsed) {
      root.innerHTML = `<style>${CSS}</style><div class="card pill ${placement}">
        <button class="x" data-action="toggle">⚡ ApplyMate</button></div>`;
      return;
    }
    const jd = `JD: ${escapeHtml(JD_LABEL[s.jdSource] ?? s.jdSource)}${
      s.jdSource === "recent"
        ? ` <button class="x" data-action="dismiss-jd" title="Not this job">×</button>`
        : ""
    }`;
    const chips = s.keywords
      .map(
        (k) =>
          `<span class="chip">${escapeHtml(k)}<button data-remove="${escapeHtml(k)}">×</button></span>`,
      )
      .join("");
    const lines = s.lines
      .map(
        (l) =>
          `<div class="line ${l.tone === "warn" || l.tone === "err" ? l.tone : ""}">${ICON[l.tone]} ${escapeHtml(l.text)}</div>`,
      )
      .join("");
    const report =
      s.injected.length || s.skipped.length
        ? `<div class="chips">${s.injected
            .map((k) => `<span class="chip ok">✓ ${escapeHtml(k)}</span>`)
            .join("")}${s.skipped
            .map(
              (k) =>
                `<span class="chip no" title="${escapeHtml(k.reason)}">✗ ${escapeHtml(k.keyword)}</span>`,
            )
            .join("")}</div>`
        : "";

    root.innerHTML = `<style>${CSS}</style><div class="card ${placement}">
      <div class="head"><span>⚡ ApplyMate</span><button class="x" data-action="toggle" title="Collapse">–</button></div>
      <div class="muted">${job}</div>
      <div class="muted">${jd}</div>
      <div class="chips">${chips}</div>
      <input data-role="kw" placeholder="Add keywords (Enter)" />
      <button class="run" data-action="run" ${s.busy ? "disabled" : ""}>${s.busy ? "Working…" : "⚡ Autofill &amp; Tailor"}</button>
      ${lines}${report}
      <div class="links">${s.canOpenPdf ? `<button data-action="pdf">Open PDF</button>` : ""}<button data-action="details">Details</button></div>
    </div>`;

    const input = root.querySelector<HTMLInputElement>("input[data-role=kw]")!;
    input.value = draft;
    if (hadFocus) input.focus();
  }

  return { render, host };
}
