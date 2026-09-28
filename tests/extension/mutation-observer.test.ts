// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { watchForInjectedFields } from "../../packages/extension/src/content/content";

describe("watchForInjectedFields", () => {
  it("fires debounced callback when a form control is injected", async () => {
    vi.useFakeTimers();
    const onChanged = vi.fn();
    const observer = watchForInjectedFields(document, onChanged);

    const input = document.createElement("input");
    document.body.appendChild(input);

    // Deliver the mutation record, then advance past the debounce window.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);

    expect(onChanged).toHaveBeenCalledTimes(1);
    observer.disconnect();
    vi.useRealTimers();
  });

  it("ignores non-form DOM churn", async () => {
    vi.useFakeTimers();
    const onChanged = vi.fn();
    const observer = watchForInjectedFields(document, onChanged);

    const div = document.createElement("div");
    div.textContent = "no controls here";
    document.body.appendChild(div);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);

    expect(onChanged).not.toHaveBeenCalled();
    observer.disconnect();
    vi.useRealTimers();
  });

  it("collapses a burst of injections into one callback", async () => {
    vi.useFakeTimers();
    const onChanged = vi.fn();
    const observer = watchForInjectedFields(document, onChanged);

    for (let i = 0; i < 5; i++) {
      document.body.appendChild(document.createElement("textarea"));
      await vi.advanceTimersByTimeAsync(50);
    }
    await vi.advanceTimersByTimeAsync(500);

    expect(onChanged).toHaveBeenCalledTimes(1);
    observer.disconnect();
    vi.useRealTimers();
  });

  it("keeps watching when a framework replaces <body> (React hydration recovery)", async () => {
    vi.useFakeTimers();
    const onChanged = vi.fn();
    const observer = watchForInjectedFields(document, onChanged);
    const fresh = document.createElement("body");
    fresh.innerHTML = "<form><input name='email'></form>";
    document.documentElement.replaceChild(fresh, document.body);
    await Promise.resolve();
    vi.advanceTimersByTime(500);
    expect(onChanged).toHaveBeenCalledTimes(1);
    observer.disconnect();
    vi.useRealTimers();
  });
});

