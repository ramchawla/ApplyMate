import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { syncToPage } from "../../packages/extension/src/ui/lib/page-sync";
import type { Proposal } from "../../lib/shared/types";

let sendMessage: ReturnType<typeof vi.fn>;
beforeEach(() => {
  sendMessage = vi.fn(async () => "ok");
  (globalThis as any).chrome = { tabs: { sendMessage } };
});
afterEach(() => vi.useRealTimers());

const run = {
  runId: "run1",
  fileName: "Ram_Chawla_Acme.pdf",
  version: 2,
  hasCoverLetterPdf: true,
  questions: [{ fieldId: "f9", label: "Expected on-target earnings" }],
};
const p = (target: string, after = "new"): Proposal => ({ target, label: "x", before: "old", after, why: "", warnings: [] });

describe("syncToPage", () => {
  it("re-attaches the resume for a resume part", async () => {
    expect(await syncToPage(7, p("r1.b2"), run)).toBe("ok");
    expect(sendMessage).toHaveBeenCalledWith(7, {
      type: "REATTACH_RESUME",
      runId: "run1",
      fileName: "Ram_Chawla_Acme.pdf",
      version: 2,
    });
  });

  it("refills the cover letter", async () => {
    await syncToPage(7, p("cover-letter", "Dear Acme"), run);
    expect(sendMessage).toHaveBeenCalledWith(7, {
      type: "REFILL_COVER_LETTER",
      runId: "run1",
      text: "Dear Acme",
      hasPdf: true,
      fileName: "Ram_Chawla_Acme.pdf",
    });
  });

  it("refills an answer by its question label", async () => {
    await syncToPage(7, p("answer:f9", "$180,000"), run);
    expect(sendMessage).toHaveBeenCalledWith(7, {
      type: "REFILL_ANSWER",
      label: "Expected on-target earnings",
      value: "$180,000",
    });
  });

  it("is not-found for an unknown answer label, without sending", async () => {
    expect(await syncToPage(7, p("answer:nope"), run)).toBe("not-found");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("is not-found when no frame answers (undefined) or sending fails", async () => {
    sendMessage.mockResolvedValueOnce(undefined);
    expect(await syncToPage(7, p("summary"), run)).toBe("not-found");
    sendMessage.mockRejectedValueOnce(new Error("Could not establish connection"));
    expect(await syncToPage(7, p("summary"), run)).toBe("not-found");
  });

  it("is not-found after 3 s of silence", async () => {
    vi.useFakeTimers();
    sendMessage.mockReturnValueOnce(new Promise(() => {}));
    const r = syncToPage(7, p("summary"), run);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await r).toBe("not-found");
  });
});
