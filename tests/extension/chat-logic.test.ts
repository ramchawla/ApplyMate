import { describe, it, expect, vi, afterEach } from "vitest";
import { FIT, isOtherField, pollUntil, streamedText } from "../../packages/extension/src/ui/lib/chat-logic";

afterEach(() => vi.useRealTimers());

describe("pollUntil", () => {
  it("checks every 2 s until the check passes", async () => {
    vi.useFakeTimers();
    let lens = [2, 2, 4];
    const check = vi.fn(async () => (lens.shift() ?? 0) > 2);
    const r = pollUntil(check, () => true);
    await vi.advanceTimersByTimeAsync(5999);
    expect(check).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(await r).toBe("done");
    expect(check).toHaveBeenCalledTimes(3);
    lens = [];
  });

  it("keeps polling through failed checks and gives up just past the 120 s stream timeout", async () => {
    vi.useFakeTimers();
    const check = vi.fn(async () => {
      throw new Error("bridge down");
    });
    const r = pollUntil(check, () => true);
    await vi.advanceTimersByTimeAsync(130_000);
    expect(await r).toBe("timeout");
    expect(check).toHaveBeenCalledTimes(65);
  });

  it("stops when the run is no longer current", async () => {
    vi.useFakeTimers();
    let alive = true;
    const check = vi.fn(async () => false);
    const r = pollUntil(check, () => alive);
    await vi.advanceTimersByTimeAsync(2000);
    alive = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(await r).toBe("cancelled");
    expect(check).toHaveBeenCalledTimes(1);
  });
});

describe("streamedText", () => {
  it("hides the proposals block and everything after it", () => {
    expect(streamedText('Sure.\n\n```proposals\n[{"target"')).toEqual({ text: "Sure.", preparing: true });
  });
  it("hides a fence still arriving", () => {
    expect(streamedText("Sure. ``")).toEqual({ text: "Sure. ", preparing: false });
    expect(streamedText("Sure. ```propo")).toEqual({ text: "Sure. ", preparing: false });
  });
  it("leaves plain text alone", () => {
    expect(streamedText("Plain reply")).toEqual({ text: "Plain reply", preparing: false });
  });
});

describe("FIT", () => {
  it("matches the bridge's length refusals only", () => {
    expect(FIT.test("2 lines too long")).toBe(true);
    expect(FIT.test("spills onto page 2")).toBe(true);
    expect(FIT.test("changed since — undo the newer change")).toBe(false);
    expect(FIT.test("unknown proposal")).toBe(false);
  });
});

describe("isOtherField", () => {
  it("is true for inputs other than the composer", () => {
    document.body.innerHTML =
      '<textarea id="composer"></textarea><textarea id="jd"></textarea><input id="tok"><div contenteditable="true"><span id="ce">x</span></div><button id="b">Apply</button>';
    const $ = (id: string) => document.getElementById(id);
    expect(isOtherField($("composer"), "composer")).toBe(false);
    expect(isOtherField($("jd"), "composer")).toBe(true);
    expect(isOtherField($("tok"), "composer")).toBe(true);
    expect(isOtherField($("ce"), "composer")).toBe(true);
    expect(isOtherField($("b"), "composer")).toBe(false);
    expect(isOtherField(document.body, "composer")).toBe(false);
  });
});
