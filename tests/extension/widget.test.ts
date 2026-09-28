import { describe, it, expect, vi } from "vitest";
import {
  mountWidget,
  escapeHtml,
  type WidgetState,
} from "../../packages/extension/src/content/widget";

const base: WidgetState = {
  mode: "form",
  title: "SRE <script>",
  company: "Acme",
  jdSource: "page",
  keywords: ["go"],
  busy: false,
  lines: [],
  injected: [],
  skipped: [],
  collapsed: false,
  canOpenPdf: false,
};

function setup() {
  const handlers = {
    onRun: vi.fn(),
    onKeywordsChange: vi.fn(),
    onDismissJD: vi.fn(),
    onOpenPdf: vi.fn(),
    onDetails: vi.fn(),
    onToggle: vi.fn(),
  };
  // Tests drive the widget with synthetic events, so opt out of the
  // trusted-input guard here (covered separately below).
  const w = mountWidget(document, handlers, "bottom", { trustedInputOnly: false });
  return { w, handlers, root: w.root };
}

describe("widget", () => {
  it("escapes page-controlled text", () => {
    const { w, root } = setup();
    w.render(base);
    expect(root.innerHTML).toContain("SRE &lt;script&gt;");
    expect(root.querySelector("script")).toBeNull();
    expect(escapeHtml(`"&'<>`)).toBe("&quot;&amp;&#39;&lt;&gt;");
  });

  it("fires onRun from the main button and disables it while busy", () => {
    const { w, root, handlers } = setup();
    w.render(base);
    (root.querySelector("[data-action=run]") as HTMLButtonElement).click();
    expect(handlers.onRun).toHaveBeenCalledOnce();
    w.render({ ...base, busy: true });
    expect((root.querySelector("[data-action=run]") as HTMLButtonElement).disabled).toBe(true);
  });

  it("adds keywords on Enter/comma and removes chips", () => {
    const { w, root, handlers } = setup();
    w.render(base);
    const input = root.querySelector("input[data-role=kw]") as HTMLInputElement;
    input.value = "kubernetes, terraform";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(handlers.onKeywordsChange).toHaveBeenLastCalledWith(["go", "kubernetes", "terraform"]);
    (root.querySelector("[data-remove='go']") as HTMLElement).click();
    expect(handlers.onKeywordsChange).toHaveBeenLastCalledWith([]);
  });

  it("shows only a JD pill on posting pages", () => {
    const { w, root } = setup();
    w.render({ ...base, mode: "posting" });
    expect(root.querySelector("[data-action=run]")).toBeNull();
    expect(root.textContent).toContain("JD saved");
  });

  it("re-attaches itself after the page re-renders and drops it", () => {
    const { w } = setup();
    w.render(base);
    w.host.remove();
    expect(w.host.isConnected).toBe(false);
    w.ensureAttached();
    expect(w.host.isConnected).toBe(true);
    expect(w.root.querySelector("[data-action=run]")).not.toBeNull();
  });

  it("ignores synthetic clicks and keys from the page by default", () => {
    const handlers = {
      onRun: vi.fn(), onKeywordsChange: vi.fn(), onDismissJD: vi.fn(),
      onOpenPdf: vi.fn(), onDetails: vi.fn(), onToggle: vi.fn(),
    };
    const w = mountWidget(document, handlers, "bottom");
    w.render(base);
    expect(w.host.shadowRoot).toBeNull(); // closed: page scripts can't reach in
    (w.root.querySelector("[data-action=run]") as HTMLButtonElement).click();
    const input = w.root.querySelector("input[data-role=kw]") as HTMLInputElement;
    input.value = "x";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(handlers.onRun).not.toHaveBeenCalled();
    expect(handlers.onKeywordsChange).not.toHaveBeenCalled();
  });
});

