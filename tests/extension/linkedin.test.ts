import { describe, it, expect } from "vitest";
import {
  isApplicationDialogOpen,
  runOneClick,
  scanForm,
} from "../../packages/extension/src/content/content";
import { normalizeProfile } from "../../packages/extension/src/utils/profile";

const STEPS = [
  `<h3>Contact info</h3>
   <label for="fn">First name</label><input id="fn" required>
   <label for="em">Email address</label><input id="em" type="email" required>
   <button aria-label="Continue to next step"><span>Next</span></button>`,
  `<h3>Additional questions</h3>
   <label for="yrs">How many years of work experience do you have with TypeScript?</label><input id="yrs" required>
   <button>Back</button><button aria-label="Review your application"><span>Review</span></button>`,
  `<h3>Review your application</h3>
   <input type="checkbox" id="follow" checked><label for="follow">Follow Acme</label>
   <button>Back</button><button aria-label="Submit application"><span>Submit application</span></button>`,
];

// LinkedIn job page: global search typeahead outside, Easy Apply modal inside.
function linkedIn() {
  const d = document.implementation.createHTMLDocument("t");
  d.body.innerHTML = `<header><input role="combobox" aria-label="Search" id="search"></header>
    <main><h1>Senior Engineer</h1><button>Easy Apply</button></main>
    <div role="dialog" class="jobs-easy-apply-modal" aria-labelledby="hdr">
      <h2 id="hdr">Apply to Acme</h2><form id="body"></form></div>`;
  const log = { at: 0, presses: [] as string[] };
  const render = () => {
    const body = d.getElementById("body")!;
    body.innerHTML = STEPS[log.at];
    for (const b of Array.from(body.querySelectorAll("button"))) {
      b.addEventListener("click", () => {
        log.presses.push(b.getAttribute("aria-label") ?? b.textContent!.trim());
        if (/submit|back/i.test(b.textContent!)) return;
        log.at++;
        render();
      });
    }
  };
  render();
  return { d, log };
}

describe("LinkedIn Easy Apply", () => {
  it("gates on the open apply dialog and scans only inside it", () => {
    const { d } = linkedIn();
    expect(isApplicationDialogOpen(d)).toBe(true);
    expect(scanForm(d, { stamp: false }).map((f) => f.id)).toEqual(["fn", "em"]);
    d.querySelector("[role=dialog]")!.remove();
    expect(isApplicationDialogOpen(d)).toBe(false);
  });

  it("ignores dialogs that aren't an application", () => {
    const d = document.implementation.createHTMLDocument("t");
    d.body.innerHTML = `<div role="dialog" aria-label="Share post"><input id="msg"><button>Send</button></div>`;
    expect(isApplicationDialogOpen(d)).toBe(false);
  });

  it("walks Next → Review and stops at Submit application", async () => {
    const { d, log } = linkedIn();
    const sent: any[] = [];
    const report = await runOneClick({
      doc: d, fields: scanForm(d), keywords: [], pollMs: 1, settleMs: 1, stepTimeoutMs: 600,
      jd: { url: "https://www.linkedin.com/jobs/view/1", title: "Senior Engineer", company: "Acme", description: "JD" },
      jdSource: "page", onStatus: () => {},
      send: async (m: any) => {
        sent.push(m);
        if (m.type === "GET_PROFILE") return normalizeProfile({ name: { first: "Jane" }, email: "j@x.com" });
        if (m.type === "TAILOR_START") return { jobId: "T" };
        if (m.type === "ANSWER_START") return { jobId: "A" };
        if (m.type === "ANSWER_POLL") return { status: "done", answers: [{ fieldId: "yrs", value: "5" }] };
        return { ok: true };
      },
    });
    expect(log.presses).toEqual(["Continue to next step", "Review your application"]);
    expect(report.stoppedAt).toBe("review");
    expect((d.getElementById("search") as HTMLInputElement).value).toBe("");
    expect((d.getElementById("follow") as HTMLInputElement).checked).toBe(true);
    expect(sent.find((m) => m.type === "ANSWER_START").request.fields.map((f: any) => f.fieldId)).toEqual(["yrs"]);
  });
});
