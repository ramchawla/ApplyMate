import { describe, it, expect, vi, afterEach } from "vitest";
import { runOneClick, trackUserEdits } from "../../packages/extension/src/content/content";
import { extractLiveFields } from "../../packages/extension/src/content/extractors/form";
import { normalizeProfile } from "../../packages/extension/src/utils/profile";

// A jsdom wizard: each step's HTML lives in `steps`; pressing the step's
// primary button swaps #step to the next one (like Workday/LinkedIn do).
function wizard(steps: string[]) {
  const d = document.implementation.createHTMLDocument("t");
  d.body.innerHTML = `<h1>Apply</h1><main id="step"></main>`;
  const log = { at: 0, nextPresses: 0, submitPresses: 0, snapshots: [] as Record<string, string>[] };
  const render = () => {
    const main = d.getElementById("step")!;
    main.innerHTML = steps[log.at];
    for (const b of Array.from(main.querySelectorAll("button:not([aria-haspopup])"))) {
      b.addEventListener("click", () => {
        const text = b.textContent!.trim();
        if (/submit/i.test(text)) return void log.submitPresses++;
        if (text === "Back") return;
        log.nextPresses++;
        // What the step held when the wizard moved on.
        const snap: Record<string, string> = {};
        for (const el of Array.from(main.querySelectorAll<HTMLInputElement>("input, textarea"))) {
          snap[el.id] = el.type === "file" ? (el.files?.[0]?.name ?? "") : el.value;
        }
        log.snapshots.push(snap);
        if (b.dataset.stay) {
          main.insertAdjacentHTML("beforeend", `<div role="alert">${b.dataset.stay}</div>`);
          return;
        }
        log.at++;
        render();
      });
    }
    // jsdom has no DataTransfer-backed FileList: capture attaches.
    for (const input of Array.from(main.querySelectorAll<HTMLInputElement>("input[type=file]"))) {
      let files: File[] = [];
      Object.defineProperty(input, "files", { set: (v) => (files = [...v]), get: () => files, configurable: true });
    }
  };
  render();
  return { d, log };
}

const RESULT = {
  applicationId: "a", fileName: "Jane_Dev_Acme.pdf", coverLetter: "Dear", hasCoverLetterPdf: false,
  answers: [], keywords: { injected: [], skipped: [] }, edits: [], warnings: [], pages: 1, savedTo: "/x",
};
const profile = normalizeProfile({ name: { first: "Jane", last: "Dev" }, email: "j@x.com" });

function bridge(answers: { fieldId: string; value: string }[] = [], hooks: { onAnswerPoll?: () => void } = {}) {
  const sent: any[] = [];
  const send = async (msg: any) => {
    sent.push(msg);
    switch (msg.type) {
      case "GET_PROFILE": return profile;
      case "TAILOR_START": return { jobId: "T" };
      case "TAILOR_POLL": return { status: "done", result: RESULT };
      case "FETCH_PDF": return { base64: btoa("%PDF") };
      case "ANSWER_START": return { jobId: "A" };
      case "ANSWER_POLL": hooks.onAnswerPoll?.(); return { status: "done", answers };
      default: return { ok: true };
    }
  };
  return { sent, send };
}

const run = (d: Document, send: (m: unknown) => Promise<any>, extra: Record<string, unknown> = {}) =>
  runOneClick({
    doc: d, fields: extractLiveFields(d), keywords: [], send, pollMs: 1, settleMs: 1, stepTimeoutMs: 600,
    jd: { url: "https://acme/jobs/1", title: "SRE", company: "Acme", description: "JD" }, jdSource: "page",
    onStatus: () => {}, ...extra,
  });

const STEP_INFO = `<h2>My Information</h2>
  <label for="first">First Name *</label><input id="first" required>
  <label for="email">Email *</label><input id="email" type="email" required>
  <button>Next</button>`;
const STEP_RESUME = `<h2>My Experience</h2>
  <label for="resume">Resume *</label><input id="resume" type="file">
  <label for="why">Why Acme? *</label><textarea id="why" required></textarea>
  <button>Back</button><button>Save and Continue</button>`;
const STEP_REVIEW = `<h2>Review</h2><p>Jane Dev</p><button>Back</button><button>Submit application</button>`;

afterEach(() => vi.unstubAllGlobals());
const stubDataTransfer = () =>
  vi.stubGlobal("DataTransfer", class { list: File[] = []; items = { add: (f: File) => this.list.push(f) }; get files() { return this.list; } });

describe("wizard engine", () => {
  it("fills each step, attaches the PDF, answers later questions, stops at review", async () => {
    stubDataTransfer();
    const { d, log } = wizard([STEP_INFO, STEP_RESUME, STEP_REVIEW]);
    const { sent, send } = bridge([{ fieldId: "why", value: "Because platforms." }]);
    const report = await run(d, send);

    expect(report.stoppedAt).toBe("review");
    expect(report.steps).toBe(3);
    expect(log.submitPresses).toBe(0);
    expect(log.snapshots[0]).toEqual({ first: "Jane", email: "j@x.com" });
    expect(log.snapshots[1]).toEqual({ resume: "Jane_Dev_Acme.pdf", why: "Because platforms." });
    // Wizard tailoring carries no questions; later steps ask /answer.
    expect(sent.filter((m) => m.type === "TAILOR_START")).toHaveLength(1);
    expect(sent.find((m) => m.type === "TAILOR_START").request.fields).toEqual([]);
    const ask = sent.find((m) => m.type === "ANSWER_START");
    expect(ask.request.fields.map((f: any) => f.fieldId)).toEqual(["why"]);
    expect(ask.request.job.company).toBe("Acme");
    expect(report.result?.fileName).toBe("Jane_Dev_Acme.pdf");
  });

  it("pauses on an empty required field without pressing Next", async () => {
    const { d, log } = wizard([
      `<label for="first">First Name *</label><input id="first" required>
       <label for="phone">Phone *</label><input id="phone" type="tel" required><button>Next</button>`,
      STEP_REVIEW,
    ]);
    const report = await run(d, bridge().send);
    expect(report.stoppedAt).toBe("needs-you");
    expect(report.needsYou).toEqual(["phone"]);
    expect(log.nextPresses).toBe(0);
  });

  it("pauses with the page's errors when Next leaves the step unchanged", async () => {
    const { d, log } = wizard([
      `<label for="first">First Name *</label><input id="first" required>
       <button data-stay="Enter a valid date">Next</button>`,
    ]);
    const report = await run(d, bridge().send);
    expect(log.nextPresses).toBe(1);
    expect(report.stoppedAt).toBe("errors");
    expect(report.errors).toEqual(["Enter a valid date"]);
  });

  it("keeps what the user typed on a step", async () => {
    const { d, log } = wizard([
      `<label for="email">Email *</label><input id="email" type="email" required>
       <label for="why">Why Acme?</label><textarea id="why"></textarea><button>Next</button>`,
      STEP_REVIEW,
    ]);
    let userTyping = false;
    const { send } = bridge([{ fieldId: "why", value: "Claude's answer." }], {
      onAnswerPoll: () => {
        userTyping = true;
        const el = d.getElementById("why") as HTMLTextAreaElement;
        el.value = "My own answer.";
        el.dispatchEvent(new Event("input", { bubbles: true }));
        userTyping = false;
      },
    });
    const report = await run(d, send, { isUserEvent: () => userTyping });
    expect(report.stoppedAt).toBe("review");
    expect(log.snapshots[0]).toEqual({ email: "j@x.com", why: "My own answer." });
  });

  it("reuses a finished tailoring job when resumed", async () => {
    const { d } = wizard([STEP_REVIEW]);
    const { sent, send } = bridge();
    const report = await run(d, send, { tailorJobId: "T0" });
    expect(sent.some((m) => m.type === "TAILOR_START")).toBe(false);
    expect(report.stoppedAt).toBe("review");
  });

  it("never re-attaches a resume the step already shows", async () => {
    stubDataTransfer();
    const { d, log } = wizard([
      `<label for="resume">Resume</label><input id="resume" type="file"><span>Jane_Dev_Acme.pdf</span><button>Next</button>`,
      STEP_REVIEW,
    ]);
    const { sent, send } = bridge();
    await run(d, send);
    expect(log.snapshots[0].resume).toBe("");
    expect(sent.some((m) => m.type === "FETCH_PDF")).toBe(false);
  });

  it("sends a profile value that fits no option to Claude instead of pausing", async () => {
    const { d, log } = wizard([
      `<label for="pdt">Phone Device Type *</label>
       <select id="pdt" required><option value="">Select One</option><option>Mobile</option><option>Home</option></select>
       <button>Next</button>`,
      STEP_REVIEW,
    ]);
    const { sent, send } = bridge([{ fieldId: "pdt", value: "Mobile" }]);
    const withPhone = async (m: any) => (m.type === "GET_PROFILE" ? normalizeProfile({ phone: "416-555-0100" }) : send(m));
    const report = await run(d, withPhone);
    expect(sent.find((m) => m.type === "ANSWER_START").request.fields.map((f: any) => f.fieldId)).toEqual(["pdt"]);
    expect(log.snapshots.length).toBe(1);
    expect(report.stoppedAt).toBe("review");
  });

  it("opens a dropdown button to show Claude its options, then picks the answer", async () => {
    const { d } = wizard([
      `<label for="dev">Phone Device Type *</label>
       <button id="dev" aria-haspopup="listbox" aria-controls="dev-lb" aria-required="true">Select One</button>
       <button>Next</button>`,
      STEP_REVIEW,
    ]);
    // Workday-style: the listbox exists only while open; Escape closes it.
    d.addEventListener("click", (e) => {
      const btn = (e.target as Element).closest("#dev");
      const opt = (e.target as Element).closest("[role=option]");
      if (opt) {
        d.getElementById("dev")!.textContent = opt.textContent;
        d.getElementById("dev-lb")?.remove();
      } else if (btn && !d.getElementById("dev-lb")) {
        d.body.insertAdjacentHTML("beforeend", `<ul role="listbox" id="dev-lb"><li role="option">Select One</li><li role="option">Mobile</li><li role="option">Home</li></ul>`);
      }
    });
    d.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") d.getElementById("dev-lb")?.remove();
    });
    let picked = "";
    const { sent, send } = bridge([]);
    const answering = async (m: any) => {
      if (m.type === "GET_PROFILE") return normalizeProfile({ phone: "416-555-0100" });
      if (m.type === "ANSWER_POLL") {
        const f = sent.find((x) => x.type === "ANSWER_START").request.fields[0];
        picked = f.options?.[0] ?? "";
        return { status: "done", answers: [{ fieldId: f.fieldId, value: picked }] };
      }
      return send(m);
    };
    const report = await run(d, answering);
    expect(sent.find((m) => m.type === "ANSWER_START").request.fields[0].options).toEqual(["Mobile", "Home"]);
    expect(picked).toBe("Mobile");
    expect(report.stoppedAt).toBe("review");
  });

  it("never asks Claude about consent checkboxes or fields that already hold a value", async () => {
    const { d, log } = wizard([
      `<label for="note">Anything else?</label><textarea id="note">Prefilled by the site</textarea>
       <label for="why">Why Acme?</label><textarea id="why"></textarea>
       <input type="checkbox" id="agree" required><label for="agree">I consent to the terms and conditions *</label>
       <button>Next</button>`,
      STEP_REVIEW,
    ]);
    const { sent, send } = bridge([{ fieldId: "agree", value: "Yes" }, { fieldId: "why", value: "Platforms." }]);
    const report = await run(d, send);
    expect(sent.find((m) => m.type === "ANSWER_START").request.fields.map((f: any) => f.fieldId)).toEqual(["why"]);
    expect((d.getElementById("agree") as HTMLInputElement).checked).toBe(false);
    expect((d.getElementById("note") as HTMLTextAreaElement).value).toBe("Prefilled by the site");
    expect(report.stoppedAt).toBe("needs-you");
    expect(report.needsYou).toEqual(["agree"]);
    expect(log.nextPresses).toBe(0);
  });

  it("never asks Claude about a field with no label", async () => {
    const { d } = wizard([`<input id="mystery"><label for="why">Why Acme?</label><textarea id="why"></textarea><button>Next</button>`, STEP_REVIEW]);
    const { sent, send } = bridge([{ fieldId: "why", value: "Platforms." }]);
    await run(d, send);
    expect(sent.find((m) => m.type === "ANSWER_START").request.fields.map((f: any) => f.fieldId)).toEqual(["why"]);
  });

  it("stops at a sign-in step without filling or pressing anything there", async () => {
    const { d, log } = wizard([
      STEP_INFO,
      `<h2>Sign In</h2><label for="em2">Email Address</label><input id="em2" type="email">
       <label for="pw">Password</label><input id="pw" type="password"><button>Continue</button>`,
    ]);
    const report = await run(d, bridge().send);
    expect(report.stoppedAt).toBe("sign-in");
    expect(log.nextPresses).toBe(1);
    expect((d.getElementById("em2") as HTMLInputElement).value).toBe("");
  });
});

describe("user edit tracking", () => {
  it("counts a dropdown pick and a shadow-DOM edit, not a mere click into a text box", () => {
    const d = document.implementation.createHTMLDocument("t");
    d.body.innerHTML = `<button data-applymate-id="country" aria-haspopup="listbox">Canada</button>
      <input data-applymate-id="city"><div id="host"></div>`;
    const shadow = d.getElementById("host")!.attachShadow({ mode: "open" });
    shadow.innerHTML = `<textarea data-applymate-id="why"></textarea>`;
    const touched = new Set<string>();
    trackUserEdits(d, touched, () => true);
    d.querySelector("[aria-haspopup]")!.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    d.querySelector("input")!.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    shadow.querySelector("textarea")!.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    expect([...touched].sort()).toEqual(["country", "why"]);
  });
});
