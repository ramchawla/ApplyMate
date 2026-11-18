import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { samePage, syncToPage } from "../../packages/extension/src/ui/lib/page-sync";
import type { Proposal } from "../../lib/shared/types";

let sendMessage: ReturnType<typeof vi.fn>;
let tabUrl: string | undefined;
beforeEach(() => {
  sendMessage = vi.fn(async () => "ok");
  tabUrl = "https://jobs.lever.co/acme/123/apply";
  (globalThis as any).chrome = { tabs: { sendMessage, get: vi.fn(async () => ({ id: 7, url: tabUrl })) } };
});
afterEach(() => vi.useRealTimers());

const run = {
  runId: "run1",
  fileName: "Ram_Chawla_Acme.pdf",
  version: 2,
  hasCoverLetterPdf: true,
  questions: [{ fieldId: "f9", label: "Expected on-target earnings" }],
  pageUrl: "https://jobs.lever.co/acme/123/apply",
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

  it("a bridge failure while fetching the PDF is reported as such", async () => {
    sendMessage.mockResolvedValueOnce("no-bridge");
    expect(await syncToPage(7, p("summary"), run)).toBe("no-bridge");
  });

  it("sends nothing when the tab moved to another job (or its URL is unknown)", async () => {
    tabUrl = "https://jobs.lever.co/other/999/apply";
    expect(await syncToPage(7, p("summary"), run)).toBe("other-page");
    tabUrl = undefined;
    expect(await syncToPage(7, p("answer:f9"), run)).toBe("other-page");
    tabUrl = "https://jobs.lever.co/acme/123";
    expect(await syncToPage(7, p("summary"), { ...run, pageUrl: undefined })).toBe("other-page");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("is not-found after 3 s of silence (6 s for a re-attach, which waits out the resume parser)", async () => {
    vi.useFakeTimers();
    sendMessage.mockReturnValueOnce(new Promise(() => {}));
    const r = syncToPage(7, p("answer:f9"), run);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await r).toBe("not-found");
    let done = false;
    sendMessage.mockReturnValueOnce(new Promise(() => {}));
    const resume = syncToPage(7, p("summary"), run).then((x) => ((done = true), x));
    await vi.advanceTimersByTimeAsync(3000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(await resume).toBe("not-found");
  });
});

describe("samePage", () => {
  it("matches the same job across its posting, apply page and wizard steps", () => {
    expect(samePage("https://jobs.lever.co/acme/123/apply", "https://jobs.lever.co/acme/123")).toBe(true);
    expect(samePage("https://acme.wd5.myworkdayjobs.com/x/job/SRE_R1/apply/applyManually", "https://acme.wd5.myworkdayjobs.com/x/job/SRE_R1")).toBe(true);
    expect(samePage("https://www.linkedin.com/jobs/search/?currentJobId=2&keywords=sre", "https://www.linkedin.com/jobs/search/?currentJobId=2")).toBe(true);
  });
  it("fails closed: another job, or a missing URL", () => {
    expect(samePage("https://jobs.lever.co/acme/999/apply", "https://jobs.lever.co/acme/123")).toBe(false);
    expect(samePage("https://www.linkedin.com/jobs/search/?currentJobId=3", "https://www.linkedin.com/jobs/search/?currentJobId=2")).toBe(false);
    expect(samePage(undefined, "https://jobs.lever.co/acme/123")).toBe(false);
    expect(samePage("https://jobs.lever.co/acme/123", undefined)).toBe(false);
    expect(samePage("", "")).toBe(false);
  });
});
