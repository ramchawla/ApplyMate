import { describe, it, expect } from "vitest";
import { OutputStore } from "../../packages/bridge/src/store";

describe("OutputStore", () => {
  it("returns null before any output is set", () => {
    const store = new OutputStore();
    expect(store.getLatest()).toBeNull();
  });

  it("stores and returns the latest output", () => {
    const store = new OutputStore();
    store.set({ jobUrl: "https://x.com/job", resumeLatex: "\\item A" } as any);
    expect(store.getLatest()?.jobUrl).toBe("https://x.com/job");
  });

  it("overwrites with the newest output", () => {
    const store = new OutputStore();
    store.set({ jobUrl: "a" } as any);
    store.set({ jobUrl: "b" } as any);
    expect(store.getLatest()?.jobUrl).toBe("b");
  });

  it("clears stored output", () => {
    const store = new OutputStore();
    store.set({ jobUrl: "a" } as any);
    store.clear();
    expect(store.getLatest()).toBeNull();
  });
});
