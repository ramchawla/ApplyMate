import { describe, it, expect } from "vitest";
import {
  extractLiveFields,
  inferValueType,
} from "../../packages/extension/src/content/extractors/form";

function doc(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
}

describe("extractLiveFields", () => {
  it("stamps controls with stable ids, reusing id/name and generating the rest", () => {
    const d = doc(
      `<input id="email" type="email"><input name="phone" type="tel"><input type="text" placeholder="City">`,
    );
    const ids = extractLiveFields(d).map((f) => f.id);
    expect(ids[0]).toBe("email");
    expect(ids[1]).toBe("phone");
    expect(ids[2]).toMatch(/^am-/);
    expect(d.querySelectorAll("[data-applymate-id]")).toHaveLength(3);
    expect(extractLiveFields(d).map((f) => f.id)).toEqual(ids);
  });

  it("can scan without touching the DOM (before a framework hydrates)", () => {
    const d = doc(`<label for="e">Email</label><input id="e" type="email"><input type="text">`);
    const fields = extractLiveFields(d, { stamp: false });
    expect(fields.map((f) => f.extractedValueType)).toEqual(["email", null]);
    expect(d.querySelectorAll("[data-applymate-id]")).toHaveLength(0);
  });

  it("skips captcha plumbing and hidden honeypots but keeps hidden file inputs", () => {
    const d = doc(`
      <textarea id="g-recaptcha-response" name="g-recaptcha-response" style="display: none"></textarea>
      <label for="hp">Website</label><input id="hp" name="website_hp" style="display:none">
      <label for="trap">Leave empty</label><input id="trap" style="visibility: hidden">
      <label for="cv">Resume/CV</label><input id="cv" type="file" style="display:none">
      <label for="e">Email</label><input id="e" type="email">`);
    expect(extractLiveFields(d).map((f) => f.id)).toEqual(["cv", "e"]);
  });

  it("skips honeypots hidden by an ancestor or pushed off-screen", () => {
    const d = doc(`
      <div style="display:none"><label for="w">Website</label><input id="w" name="website"></div>
      <label for="o">Company</label><input id="o" style="position:absolute; left:-9999px">
      <div style="display:none"><label for="cv2">Resume</label><input id="cv2" type="file"></div>
      <label for="e">Email</label><input id="e" type="email">`);
    expect(extractLiveFields(d).map((f) => f.id)).toEqual(["cv2", "e"]);
  });

  it("keeps custom-styled radios and checkboxes (opacity 0 behind a styled span)", () => {
    const d = doc(`<fieldset><label for="g">Gender</label>
      <div><input type="radio" id="g0" name="g" style="opacity:0; position:absolute; left:-10000px"><label for="g0">Male</label></div>
      <div><input type="radio" id="g1" name="g" style="opacity:0; position:absolute; left:-10000px"><label for="g1">Decline</label></div></fieldset>
      <label><input type="checkbox" id="c" style="opacity:0; position:absolute; left:-10000px"> I agree</label>`);
    expect(extractLiveFields(d).map((f) => f.id)).toEqual(["g", "c"]);
  });

  it("skips hidden, submit and button inputs", () => {
    const d = doc(
      `<input type="hidden" name="h"><input type="submit"><input type="button"><input name="x">`,
    );
    expect(extractLiveFields(d).map((f) => f.id)).toEqual(["x"]);
  });

  it("resolves labels from for=, wrapping label, aria-labelledby, aria-label", () => {
    const d = doc(`
      <label for="a">First Name</label><input id="a">
      <label>Last Name <input id="b"></label>
      <span id="lc">Current Company</span><input id="c" aria-labelledby="lc">
      <input id="d" aria-label="LinkedIn Profile">`);
    expect(extractLiveFields(d).map((f) => [f.label, f.extractedValueType])).toEqual([
      ["First Name", "first-name"],
      ["Last Name", "last-name"],
      ["Current Company", "current-company"],
      ["LinkedIn Profile", "linkedin"],
    ]);
  });

  it("uses Lever-style sibling question text", () => {
    const d = doc(`
      <li class="application-question">
        <div class="application-label">Why do you want to join?</div>
        <div class="application-field"><textarea name="cards[0]"></textarea></div>
      </li>`);
    const [f] = extractLiveFields(d);
    expect(f.label).toBe("Why do you want to join?");
    expect(f.extractedValueType).toBe("custom-q");
  });

  it("collapses a radio group into one field with question and options", () => {
    const d = doc(`
      <fieldset><legend>Are you legally authorized to work in the United States? *</legend>
        <label><input type="radio" name="auth" value="1"> Yes</label>
        <label><input type="radio" name="auth" value="0"> No</label>
      </fieldset>`);
    const fields = extractLiveFields(d);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      id: "auth",
      type: "radio",
      label: "Are you legally authorized to work in the United States?",
      options: ["Yes", "No"],
      required: true,
      extractedValueType: "work-auth",
    });
  });

  it("lists select options without placeholders and reads aria-required", () => {
    const d = doc(`<label for="g">Gender</label>
      <select id="g" aria-required="true"><option value="">Select...</option><option>Male</option><option>Female</option><option>Decline to self-identify</option></select>`);
    const [f] = extractLiveFields(d);
    expect(f.options).toEqual(["Male", "Female", "Decline to self-identify"]);
    expect(f.required).toBe(true);
    expect(f.extractedValueType).toBe("gender");
  });

  it("skips aria-hidden validation inputs (Greenhouse requiredInput)", () => {
    const d = doc(`
      <div class="field-wrapper"><label id="q-label" for="q">Do you require visa sponsorship? <span aria-hidden="true">*</span></label>
        <input id="q" role="combobox" aria-labelledby="q-label" aria-required="true">
        <input required tabindex="-1" aria-hidden="true" class="requiredInput" value="">
      </div>
      <div class="question-description"><p>How do you pronounce your name?</p></div>`);
    const fields = extractLiveFields(d);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ id: "q", type: "combobox", extractedValueType: "sponsorship", required: true });
  });

  it("carries the question description for Claude", () => {
    const d = doc(`
      <label for="why">Why Anthropic?<span aria-hidden="true">*</span></label>
      <textarea id="why" aria-describedby="why-description why-error" aria-required="true"></textarea>
      <div id="why-description"><p>Why do you want to work here? Great answers are 200-400 words.</p></div>
      <div id="why-error"></div>`);
    expect(extractLiveFields(d)[0]).toMatchObject({
      label: "Why Anthropic?",
      description: "Why do you want to work here? Great answers are 200-400 words.",
    });
  });

  it("extracts Ashby yes/no button questions as one choice field", () => {
    const d = doc(`
      <div data-field-path="auth"><label for="auth">Are you authorized to work in the country where the job is located?</label>
        <div><button aria-pressed="false" data-option="yes">Yes</button><button aria-pressed="false" data-option="no">No</button>
        <input type="checkbox" tabindex="-1" name="auth"></div></div>`);
    const fields = extractLiveFields(d);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      type: "radio",
      label: "Are you authorized to work in the country where the job is located?",
      options: ["Yes", "No"],
      extractedValueType: "work-auth",
    });
  });

  it("labels Ashby radio groups from the fieldset's question label", () => {
    const d = doc(`<h1 id="tab" class="application-label">Application</h1>
      <div role="tabpanel" aria-labelledby="tab">
      <div data-field-path="g"><fieldset><label for="g">Gender</label>
        <div><input type="radio" id="g-0" name="gg"><label for="g-0">Male</label></div>
        <div><input type="radio" id="g-1" name="gg"><label for="g-1">Decline to self-identify</label></div>
      </fieldset></div></div>`);
    expect(extractLiveFields(d)[0]).toMatchObject({ label: "Gender", options: ["Male", "Decline to self-identify"] });
  });

  it("uses a dangling label[for] in the same field block (Ashby location)", () => {
    const d = doc(`
      <div data-field-path="name"><label for="name">Legal Name</label><p>Please enter your legal name exactly as on your ID.</p><input id="name"></div>
      <div data-field-path="loc"><label for="loc">Where are you currently located?</label><div><input role="combobox" placeholder="Start typing..."></div></div>`);
    expect(extractLiveFields(d)[1]).toMatchObject({ label: "Where are you currently located?", extractedValueType: "location" });
  });

  it("cuts Lever's ✱ marker and trailing helper text out of labels", () => {
    const d = doc(`<li class="application-question"><div class="application-label">Current location ✱No location found. Try entering a different location</div>
      <div class="application-field"><input name="location"></div></li>
      <li class="application-question"><div class="application-label">Please tell us how you heard about this opportunity ✱</div>
      <div class="application-field"><select name="src"><option>LinkedIn</option></select></div></li>`);
    const [loc, src] = extractLiveFields(d);
    expect(loc).toMatchObject({ label: "Current location", required: true, extractedValueType: "location" });
    expect(src).toMatchObject({ extractedValueType: "how-heard", required: true });
  });

  it("marks ARIA comboboxes", () => {
    const d = doc(`<label for="loc">Location (City)</label><input id="loc" role="combobox">`);
    expect(extractLiveFields(d)[0]).toMatchObject({
      type: "combobox",
      extractedValueType: "location",
    });
  });

  it("extracts non-native ARIA radiogroups", () => {
    const d = doc(`<div role="radiogroup" aria-label="Will you require sponsorship?">
      <div role="radio">Yes</div><div role="radio">No</div></div>`);
    expect(extractLiveFields(d)[0]).toMatchObject({
      type: "radio",
      options: ["Yes", "No"],
      extractedValueType: "sponsorship",
    });
  });
});

describe("inferValueType", () => {
  const t = (label: string, htmlType = "text", ac = "", type: any = "text") =>
    inferValueType(label.toLowerCase(), htmlType, ac, type).valueType;
  it("prefers autocomplete tokens", () => {
    expect(t("Field 1", "text", "given-name")).toBe("first-name");
    expect(t("x", "text", "section-a address-level2")).toBe("city");
  });
  it("leaves labels that only contain a mapped word unmapped (live Workday)", () => {
    for (const label of ["Middle Name", "Address Line 2", "Phone Extension", "Phone Device Type", "Country Phone Code"]) {
      expect(t(label)).toBeNull();
    }
    expect(t("Phone Number")).toBe("phone");
    expect(t("Address Line 1")).toBe("address");
    expect(t("Last Name")).toBe("last-name");
    // A mapped word as a SUBSTRING of a longer, unrelated label must not match.
    expect(t("Phone number (including country code)")).toBe("phone");
    expect(t("Mobile phone (with extension)")).toBe("phone");
  });
  it("classifies a resume field even when its label mentions a file extension", () => {
    expect(t("Resume (file extension: pdf)", "file")).toBe("resume");
  });
  it("keeps real optional fields whose helper text mentions leaving them blank", () => {
    const d = document.implementation.createHTMLDocument("t");
    d.body.innerHTML = `<label for="li">LinkedIn Profile (leave blank if none)</label><input id="li">
      <label for="pn">Preferred name - leave blank if same as legal name</label><input id="pn">`;
    expect(extractLiveFields(d, { stamp: false }).map((f) => f.label)).toHaveLength(2);
  });

  it("skips honeypots that announce themselves in the label (live Workday)", () => {
    const d = document.implementation.createHTMLDocument("t");
    d.body.innerHTML = `<label for="e">Email Address</label><input id="e" type="email">
      <label for="w">Enter website. This input is for robots only, do not enter if you're human.</label><input id="w">`;
    expect(extractLiveFields(d, { stamp: false }).map((f) => f.label)).toEqual(["Email Address"]);
  });
  it("never extracts page menus as dropdown questions", () => {
    const d = document.implementation.createHTMLDocument("t");
    d.body.innerHTML = `<header><button aria-haspopup="listbox" id="settingsSelectorButton"></button>
        <button aria-haspopup="listbox" aria-label="Language">English</button></header>
      <label for="c">Country</label><button id="c" aria-haspopup="listbox">Canada</button>`;
    expect(extractLiveFields(d, { stamp: false }).map((f) => f.label)).toEqual(["Country"]);
  });
  it("classifies file inputs", () => {
    expect(t("Resume/CV", "file")).toBe("resume");
    expect(t("Cover Letter", "file")).toBe("cover-letter");
  });
  it("handles long question labels", () => {
    expect(
      t("Will you now or in the future require sponsorship for employment visa status (e.g., H-1B)?"),
    ).toBe("sponsorship");
    expect(
      t("Have you previously worked for this employer or any of its subsidiaries?"),
    ).toBe("custom-q");
    expect(
      t("Please describe your experience with open source software", "text", "", "textarea"),
    ).toBe("custom-q");
  });
  it("respects word boundaries and ordering", () => {
    expect(t("Location (City)")).toBe("location");
    expect(t("Company name")).toBe("current-company");
    expect(t("Personal statement")).toBeNull();
    expect(t("Email", "email")).toBe("email");
  });
});

describe("checkbox groups", () => {
  it("keeps a real multi-select group together (one shared fieldset)", () => {
    document.body.innerHTML = `<fieldset><legend>Languages spoken</legend>
      <label><input type="checkbox" name="lang" value="en">English</label>
      <label><input type="checkbox" name="lang" value="fr">French</label></fieldset>`;
    const [f] = extractLiveFields(document, { stamp: false });
    expect(f.options).toEqual(["English", "French"]);
    document.body.innerHTML = "";
  });

  it("never merges the same checkbox name across separate repeating entries (real Workday, scanned from the whole page)", () => {
    document.body.innerHTML = `
      <div role="group"><h4>Work Experience 1</h4><input type="checkbox" name="currentlyWorkHere" id="cw1"><label for="cw1">I currently work here</label></div>
      <div role="group"><h4>Work Experience 2</h4><input type="checkbox" name="currentlyWorkHere" id="cw2"><label for="cw2">I currently work here</label></div>`;
    // A full-page scan, as the wizard loop does every step — not scoped to one entry.
    const fields = extractLiveFields(document);
    const cw = fields.filter((f) => f.label === "I currently work here");
    expect(cw).toHaveLength(2);
    expect(cw[0].id).not.toBe(cw[1].id);
    document.body.innerHTML = "";
  });
});

describe("scrolled pages", () => {
  it("keeps fields scrolled above the viewport but drops ones parked off the page", () => {
    document.body.innerHTML = `<label for="a">City</label><input id="a"><label for="b">Website</label><input id="b">`;
    const rects: Record<string, object> = {
      a: { width: 300, left: 20, right: 320, top: -80, bottom: -50 }, // scrolled past
      b: { width: 300, left: -9999, right: -9699, top: 400, bottom: 430 }, // honeypot
    };
    for (const id of ["a", "b"]) {
      const el = document.getElementById(id) as any;
      el.checkVisibility = () => true;
      el.getBoundingClientRect = () => rects[id];
    }
    Object.defineProperty(window, "scrollY", { value: 600, configurable: true });
    try {
      expect(extractLiveFields(document, { stamp: false }).map((f) => f.label)).toEqual(["City"]);
    } finally {
      Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
      document.body.innerHTML = "";
    }
  });
});
