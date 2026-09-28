import { describe, it, expect, vi } from "vitest";
import {
  isApplicationForm,
  isSubmitControl,
  isPostingPage,
  runOneClick,
} from "../../packages/extension/src/content/content";
import { extractLiveFields } from "../../packages/extension/src/content/extractors/form";
import { normalizeProfile } from "../../packages/extension/src/utils/profile";

const GREENHOUSE_LIKE = `
  <form>
    <label for="first_name">First Name *</label><input id="first_name" required>
    <label for="last_name">Last Name *</label><input id="last_name" required>
    <label for="email">Email *</label><input id="email" type="email" required>
    <label for="phone">Phone</label><input id="phone" type="tel">
    <label for="resume">Resume/CV *</label><input id="resume" type="file" required>
    <label for="q1">Why do you want to work at Acme? *</label><textarea id="q1" required aria-describedby="q1-d"></textarea><p id="q1-d">Tell us in 200-400 words.</p>
    <label for="q2">Are you legally authorized to work in Canada?</label>
    <select id="q2"><option value="">Select...</option><option>Yes</option><option>No</option></select>
    <button type="submit">Submit application</button>
  </form>`;

function page(html: string): Document {
  const d = document.implementation.createHTMLDocument("t");
  d.body.innerHTML = html;
  return d;
}

describe("gating", () => {
  it("recognizes application forms but not newsletters or logins", () => {
    expect(isApplicationForm(extractLiveFields(page(GREENHOUSE_LIKE)))).toBe(true);
    expect(
      isApplicationForm(
        extractLiveFields(page(`<input type="email" placeholder="Email"><button>Subscribe</button>`)),
      ),
    ).toBe(false);
    expect(
      isApplicationForm(extractLiveFields(page(`<input type="email"><input type="password">`))),
    ).toBe(false);
  });
  it("recognizes submit controls but not Next/Apply-for-job links", () => {
    const d = page(
      `<button id="a">Submit application</button><button id="b">Next</button><button id="c"><span>Submit</span></button><a id="d">Apply for this job</a>`,
    );
    expect(isSubmitControl(d.getElementById("a")!)).toBe(true);
    expect(isSubmitControl(d.getElementById("b")!)).toBe(false);
    expect(isSubmitControl(d.querySelector("#c span")!)).toBe(true);
    expect(isSubmitControl(d.getElementById("d")!)).toBe(false);
  });
  it("treats named boards and JSON-LD postings as posting pages", () => {
    expect(isPostingPage("lever", 0.95)).toBe(true);
    expect(isPostingPage("generic", 0.75)).toBe(true);
    expect(isPostingPage("generic", 0.3)).toBe(false);
    expect(isPostingPage("unknown", 0)).toBe(false);
  });
});

describe("runOneClick", () => {
  it("fills instantly, tailors, attaches the PDF, answers questions, re-applies", async () => {
    const d = page(GREENHOUSE_LIKE);
    const fields = extractLiveFields(d);
    const profile = normalizeProfile({ name: { first: "Jane", last: "Dev" }, email: "j@x.com" });
    const attached: File[] = [];
    Object.defineProperty(d.getElementById("resume"), "files", {
      set: (v) => attached.push(...v),
      get: () => attached,
      configurable: true,
    });
    vi.stubGlobal(
      "DataTransfer",
      class {
        list: File[] = [];
        items = { add: (f: File) => this.list.push(f) };
        get files() {
          return this.list;
        }
      },
    );

    const sent: any[] = [];
    let polls = 0;
    const send = async (msg: any) => {
      sent.push(msg);
      switch (msg.type) {
        case "GET_PROFILE":
          return profile;
        case "TAILOR_START":
          return { jobId: "J1" };
        case "TAILOR_POLL":
          return ++polls < 2
            ? { status: "running" }
            : {
                status: "done",
                result: {
                  applicationId: "a",
                  fileName: "Jane_Dev_Acme.pdf",
                  coverLetter: "Dear",
                  hasCoverLetterPdf: false,
                  answers: [
                    { fieldId: "q1", value: "Because platforms." },
                    { fieldId: "q2", value: "Yes" },
                  ],
                  keywords: { injected: [{ keyword: "go", where: "r0.b0" }], skipped: [] },
                  edits: [],
                  warnings: [],
                  pages: 1,
                  savedTo: "/x",
                },
              };
        case "FETCH_PDF":
          return { base64: btoa("%PDF") };
        default:
          return { ok: true };
      }
    };

    const statuses: string[] = [];
    const report = await runOneClick({
      doc: d,
      fields,
      keywords: ["go"],
      send,
      pollMs: 1,
      settleMs: 1,
      jd: { url: "https://acme/jobs/1", title: "SRE", company: "Acme", description: "JD" },
      jdSource: "page",
      onStatus: (lines) => statuses.push(lines.map((l) => l.text).join(" | ")),
    });

    expect((d.getElementById("first_name") as HTMLInputElement).value).toBe("Jane");
    expect((d.getElementById("email") as HTMLInputElement).value).toBe("j@x.com");
    expect((d.getElementById("q1") as HTMLTextAreaElement).value).toBe("Because platforms.");
    expect((d.getElementById("q2") as HTMLSelectElement).value).toBe("Yes");
    expect(attached[0].name).toBe("Jane_Dev_Acme.pdf");
    const start = sent.find((m) => m.type === "TAILOR_START");
    expect(start.request.fields.map((f: any) => f.fieldId)).toEqual(["phone", "q1", "q2"]);
    expect(start.request.keywords).toEqual(["go"]);
    expect(start.request.fields.find((f: any) => f.fieldId === "q1").label).toBe(
      "Why do you want to work at Acme? — Tell us in 200-400 words.",
    );
    expect(report.result?.fileName).toBe("Jane_Dev_Acme.pdf");
    expect(report.needsYou).toEqual([]);
    expect(statuses[0]).toMatch(/filled/);
    expect(sent.some((m) => m.type === "RUN_REPORT")).toBe(true);
    vi.unstubAllGlobals();
  });

  it("keeps the instant fill and reports when the bridge is offline", async () => {
    const d = page(GREENHOUSE_LIKE);
    const report = await runOneClick({
      doc: d,
      fields: extractLiveFields(d),
      keywords: [],
      pollMs: 1,
      settleMs: 1,
      jd: { url: "u", title: "", company: "", description: "" },
      jdSource: "none",
      send: async (msg: any) =>
        msg.type === "GET_PROFILE" ? normalizeProfile({ email: "j@x.com" }) : { error: "Failed to fetch" },
      onStatus: () => {},
    });
    expect((d.getElementById("email") as HTMLInputElement).value).toBe("j@x.com");
    expect(report.error).toMatch(/bridge/i);
    expect(report.needsYou).toContain("first_name");
  });

  it("survives a background worker that errors on every message", async () => {
    const d = page(GREENHOUSE_LIKE);
    const report = await runOneClick({
      doc: d,
      fields: extractLiveFields(d),
      keywords: [],
      pollMs: 1,
      settleMs: 1,
      jd: { url: "u", title: "", company: "", description: "" },
      jdSource: "none",
      send: async () => ({ error: "Could not establish connection" }),
      onStatus: () => {},
    });
    expect(report.filled).toBe(0);
    expect(report.error).toMatch(/Could not establish connection/);
  });

  it("attaches to the labelled Resume field, not an unlabelled autofill drop zone", async () => {
    const d = page(`
      <div><input type="file" id="dropzone"></div>
      <form><label for="first_name">First Name</label><input id="first_name">
      <label for="email">Email</label><input id="email" type="email">
      <label for="res">Resume</label><input type="file" id="res"></form>`);
    const got: Record<string, File[]> = { dropzone: [], res: [] };
    for (const id of ["dropzone", "res"]) {
      Object.defineProperty(d.getElementById(id), "files", { set: (v) => got[id].push(...v), get: () => got[id], configurable: true });
    }
    vi.stubGlobal("DataTransfer", class { list: File[] = []; items = { add: (f: File) => this.list.push(f) }; get files() { return this.list; } });
    await runOneClick({
      doc: d, fields: extractLiveFields(d), keywords: [], pollMs: 1, settleMs: 1,
      jd: { url: "u", title: "", company: "", description: "" }, jdSource: "none",
      send: async (msg: any) => msg.type === "GET_PROFILE" ? normalizeProfile({}) : msg.type === "TAILOR_START" ? { jobId: "J" }
        : msg.type === "TAILOR_POLL" ? { status: "done", result: { applicationId: "a", fileName: "R.pdf", coverLetter: "", hasCoverLetterPdf: false, answers: [], keywords: { injected: [], skipped: [] }, edits: [], warnings: [], pages: 1, savedTo: "/x" } }
        : msg.type === "FETCH_PDF" ? { base64: btoa("%PDF") } : { ok: true },
      onStatus: () => {},
    });
    expect(got.res.map((f) => f.name)).toEqual(["R.pdf"]);
    expect(got.dropzone).toEqual([]);
    vi.unstubAllGlobals();
  });
});
