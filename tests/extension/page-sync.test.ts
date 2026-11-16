import { describe, it, expect, vi, afterEach } from "vitest";
import { handlePageSync, normalizeLabel } from "../../packages/extension/src/content/page-sync";

function page(html: string) {
  const d = document.implementation.createHTMLDocument("t");
  d.body.innerHTML = html;
  // jsdom has no DataTransfer-backed FileList: capture attaches.
  const attached: Record<string, string[]> = {};
  for (const input of Array.from(d.querySelectorAll<HTMLInputElement>("input[type=file]"))) {
    attached[input.id] = [];
    let files: File[] = [];
    Object.defineProperty(input, "files", {
      set: (v) => {
        files = [...v];
        attached[input.id].push(...files.map((f) => f.name));
      },
      get: () => files,
      configurable: true,
    });
  }
  return { d, attached };
}

function bridge() {
  const sent: any[] = [];
  const send = async (msg: any) => {
    sent.push(msg);
    return msg.type === "FETCH_RUN_PDF" ? { base64: btoa("%PDF") } : { ok: true };
  };
  return { sent, send };
}

afterEach(() => vi.unstubAllGlobals());
const stubDataTransfer = () =>
  vi.stubGlobal("DataTransfer", class { list: File[] = []; items = { add: (f: File) => this.list.push(f) }; get files() { return this.list; } });

describe("page sync", () => {
  it("normalizes labels", () => {
    expect(normalizeLabel("  Why   Acme?\n *")).toBe("why acme?");
    expect(normalizeLabel("Salary Expectations*")).toBe("salary expectations");
  });

  it("REATTACH_RESUME attaches the fetched PDF to the resume input", async () => {
    stubDataTransfer();
    const { d, attached } = page(`<label for="first">First Name</label><input id="first">
      <label for="resume">Resume *</label><input id="resume" type="file">`);
    const { sent, send } = bridge();
    const res = await handlePageSync(d, { type: "REATTACH_RESUME", runId: "run-ps", fileName: "Jane_Dev_Acme.pdf", version: 2 }, { send, touched: new Set() });
    expect(res).toBe("ok");
    expect(attached.resume).toEqual(["Jane_Dev_Acme.pdf"]);
    expect(sent).toEqual([{ type: "FETCH_RUN_PDF", runId: "run-ps", kind: "resume" }]);
  });

  it("REATTACH_RESUME is not-found when the step has no resume input", async () => {
    const { d } = page(`<label for="first">First Name</label><input id="first">`);
    const { sent, send } = bridge();
    const res = await handlePageSync(d, { type: "REATTACH_RESUME", runId: "r", fileName: "R.pdf", version: 1 }, { send, touched: new Set() });
    expect(res).toBe("not-found");
    expect(sent).toEqual([]);
  });

  it("REFILL_ANSWER fills by label and marks the field touched", async () => {
    const { d } = page(`<label for="why">Why Acme? *</label><textarea id="why">Old answer.</textarea>
      <button id="next">Next</button>`);
    let pressed = 0;
    d.getElementById("next")!.addEventListener("click", () => pressed++);
    const touched = new Set<string>(["why"]); // the user edited it before: chat apply is their call
    const res = await handlePageSync(d, { type: "REFILL_ANSWER", label: "why  acme?", value: "New answer." }, { send: bridge().send, touched });
    expect(res).toBe("ok");
    expect((d.getElementById("why") as HTMLTextAreaElement).value).toBe("New answer.");
    expect(touched.has("why")).toBe(true);
    expect(pressed).toBe(0);
  });

  it("REFILL_ANSWER matches the asked question label (with its description)", async () => {
    const { d } = page(`<label for="q1">Why Acme?</label><textarea id="q1" aria-describedby="q1-d"></textarea><p id="q1-d">200 words.</p>`);
    const touched = new Set<string>();
    const res = await handlePageSync(d, { type: "REFILL_ANSWER", label: "Why Acme? — 200 words.", value: "Platforms." }, { send: bridge().send, touched });
    expect(res).toBe("ok");
    expect((d.getElementById("q1") as HTMLTextAreaElement).value).toBe("Platforms.");
    expect([...touched]).toEqual(["q1"]);
  });

  it("REFILL_ANSWER is not-found when the label isn't on the page", async () => {
    const { d } = page(`<label for="why">Why Acme?</label><textarea id="why"></textarea>`);
    const touched = new Set<string>();
    const res = await handlePageSync(d, { type: "REFILL_ANSWER", label: "Salary expectations", value: "120k" }, { send: bridge().send, touched });
    expect(res).toBe("not-found");
    expect((d.getElementById("why") as HTMLTextAreaElement).value).toBe("");
    expect(touched.size).toBe(0);
  });

  it("REFILL_ANSWER never checks a lone consent checkbox", async () => {
    const { d } = page(`<input type="checkbox" id="agree"><label for="agree">I agree to the terms</label>`);
    const res = await handlePageSync(d, { type: "REFILL_ANSWER", label: "I agree to the terms", value: "Yes" }, { send: bridge().send, touched: new Set() });
    expect(res).toBe("not-found");
    expect((d.getElementById("agree") as HTMLInputElement).checked).toBe(false);
  });

  it("REFILL_COVER_LETTER fills the textarea", async () => {
    const { d } = page(`<label for="cl">Cover Letter</label><textarea id="cl"></textarea>`);
    const touched = new Set<string>();
    const { sent, send } = bridge();
    const res = await handlePageSync(d, { type: "REFILL_COVER_LETTER", runId: "r", text: "Dear Acme,", hasPdf: false, fileName: "R.pdf" }, { send, touched });
    expect(res).toBe("ok");
    expect((d.getElementById("cl") as HTMLTextAreaElement).value).toBe("Dear Acme,");
    expect(touched.has("cl")).toBe(true);
    expect(sent).toEqual([]);
  });

  it("REFILL_COVER_LETTER attaches the cover-letter PDF when hasPdf", async () => {
    stubDataTransfer();
    const { d, attached } = page(`<label for="resume">Resume</label><input id="resume" type="file">
      <label for="cl">Cover Letter</label><input id="cl" type="file">`);
    const { sent, send } = bridge();
    const res = await handlePageSync(d, { type: "REFILL_COVER_LETTER", runId: "r", text: "Dear", hasPdf: true, fileName: "Jane_Dev_Acme.pdf" }, { send, touched: new Set() });
    expect(res).toBe("ok");
    expect(attached.cl).toEqual(["Jane_Dev_Acme_Cover_Letter.pdf"]);
    expect(attached.resume).toEqual([]);
    expect(sent).toEqual([{ type: "FETCH_RUN_PDF", runId: "r", kind: "cover-letter" }]);
  });

  it("REFILL_COVER_LETTER is not-found without a cover-letter field", async () => {
    const { d } = page(`<label for="first">First Name</label><input id="first">`);
    const res = await handlePageSync(d, { type: "REFILL_COVER_LETTER", runId: "r", text: "Dear", hasPdf: true, fileName: "R.pdf" }, { send: bridge().send, touched: new Set() });
    expect(res).toBe("not-found");
  });
});
