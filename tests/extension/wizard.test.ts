import { describe, it, expect } from "vitest";
import {
  activeScope,
  findStepButton,
  stepSignature,
  visibleErrors,
  waitForStepChange,
} from "../../packages/extension/src/content/wizard";

function page(html: string): Document {
  const d = document.implementation.createHTMLDocument("t");
  d.body.innerHTML = html;
  return d;
}

describe("findStepButton", () => {
  it("finds an advance button on intermediate steps", () => {
    const d = page(`<label for="a">First Name</label><input id="a"><button>Cancel</button><button>Next</button>`);
    expect(findStepButton(d)).toMatchObject({ kind: "advance" });
    expect(findStepButton(d)!.el.textContent).toBe("Next");
  });

  it("stops at submit even when Back is present (LinkedIn review)", () => {
    const d = page(`<button aria-label="Back to previous step">Back</button><button aria-label="Submit application">Submit application</button>`);
    expect(findStepButton(d)).toMatchObject({ kind: "submit" });
  });

  it("recognizes Workday's footer button by automation id", () => {
    const d = page(`<button data-automation-id="pageFooterNextButton">Save and Continue</button>`);
    expect(findStepButton(d)).toMatchObject({ kind: "advance" });
  });

  it("prefers the open dialog over page buttons", () => {
    const d = page(`<button>Submit</button>
      <div role="dialog"><input name="x"><button aria-label="Continue to next step">Next</button></div>`);
    const b = findStepButton(d)!;
    expect(b.kind).toBe("advance");
    expect(b.el.closest("[role=dialog]")).not.toBeNull();
    expect(activeScope(d)).toBe(d.querySelector("[role=dialog]"));
  });

  it("ignores disabled and hidden buttons", () => {
    const d = page(`<button disabled>Next</button><button style="display:none">Submit</button>`);
    expect(findStepButton(d)).toBeNull();
  });
});

describe("step change + errors", () => {
  it("detects a new step and times out when nothing changes", async () => {
    const d = page(`<h2>My Information</h2><label for="a">First Name</label><input id="a">`);
    const before = stepSignature(d);
    setTimeout(() => {
      d.body.innerHTML = `<h2>My Experience</h2><label for="t">Job Title</label><input id="t">`;
    }, 20);
    expect(await waitForStepChange(d, before, 2000)).toBe(true);
    expect(await waitForStepChange(d, stepSignature(d), 150)).toBe(false);
  });

  it("never treats an unrecognised footer button as advance, whatever its automation id", () => {
    const d = page(`<label for="a">Name</label><input id="a">
      <button data-automation-id="bottom-navigation-next-button">Soumettre</button>
      <button data-automation-id="pageFooterNextButton">Confirm and submit</button>`);
    expect(findStepButton(d)).toBeNull();
  });

  it("keeps an apply dialog as the scope even when a step has no fields", () => {
    const d = page(`<input role="combobox" aria-label="Search">
      <div role="dialog" aria-labelledby="h"><h2 id="h">Apply to Acme</h2><p>Review</p>
        <button aria-label="Submit application">Submit application</button></div>`);
    expect(activeScope(d)).toBe(d.querySelector("[role=dialog]"));
  });

  it("a cookie/consent dialog never captures the scope", () => {
    const d = page(`<label for="a">First Name</label><input id="a"><button>Submit application</button>
      <div role="dialog" aria-label="Cookie consent"><input type="checkbox" id="c"><button>Accept all</button></div>
      <div role="dialog" aria-label="Notice"><button>Next</button></div>`);
    expect(activeScope(d)).toBe(d);
    expect(findStepButton(d)).toMatchObject({ kind: "submit" });
  });

  it("sees a step that re-rendered synchronously inside the press", async () => {
    const d = page(`<h2>My Information</h2><label for="a">First Name</label><input id="a">`);
    const before = stepSignature(d);
    d.body.innerHTML = `<h2>Review</h2>`;
    expect(await waitForStepChange(d, before, 1000)).toBe(true);
  });

  it("collects visible validation errors", () => {
    const d = page(`<div role="alert">Email is required</div><label for="p">Phone</label><input id="p" aria-invalid="true">
      <div data-automation-id="errorMessage">Enter a valid date</div>`);
    expect(visibleErrors(d)).toEqual(["Email is required", "Phone", "Enter a valid date"]);
  });
});
