import { describe, it, expect } from "vitest";
import {
  answerQuestions,
  buildAnswerPrompt,
  ANSWER_SYSTEM,
} from "../../packages/skill/src/tailor/answer";

const req = {
  job: { title: "SRE", company: "Acme", url: "https://x/1", description: "Run Kubernetes." },
  fields: [
    { fieldId: "dev", label: "Phone Device Type", type: "combobox", options: ["Mobile", "Home"], required: true },
    { fieldId: "why", label: "Why Acme?", type: "textarea", required: false },
  ],
};
const files = { corpusYaml: "experiences: [k8s]", profileYaml: "name: {first: Jane}" };

describe("answers-only prompt", () => {
  it("has the job, questions with options, corpus and profile — no resume parts", () => {
    const p = buildAnswerPrompt(req, files);
    expect(p).toContain("Run Kubernetes.");
    expect(p).toContain("[dev] Phone Device Type (combobox; required; options: Mobile | Home)");
    expect(p).toContain("experiences: [k8s]");
    expect(p).toContain("name: {first: Jane}");
    expect(p).not.toContain("Resume parts");
    expect(ANSWER_SYSTEM).toMatch(/untrusted/i);
    expect(ANSWER_SYSTEM).toMatch(/exactly one of the listed options/);
  });

  it("ties 'why this company' answers to the profile's motivations", () => {
    expect(ANSWER_SYSTEM).toMatch(/motivations/);
    expect(ANSWER_SYSTEM).toMatch(/why this company|what interests you/i);
  });

  it("returns only answers for asked fields", async () => {
    const out = await answerQuestions(req, files, {
      runClaude: async () => ({
        answers: [
          { fieldId: "dev", value: "Mobile" },
          { fieldId: "email", value: "x@evil.test" },
        ],
      }),
    });
    expect(out.answers).toEqual([{ fieldId: "dev", value: "Mobile" }]);
  });
});
