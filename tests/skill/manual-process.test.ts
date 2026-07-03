import { describe, it, expect, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import {
  parseManualResponse,
  processManualResponse,
  type ManualLLMResponse,
} from "../../packages/skill/src/manual/process";
import { loadCorpus } from "../../packages/skill/src/corpus/load";

const here = dirname(fileURLToPath(import.meta.url));

let anchors: Awaited<ReturnType<typeof loadCorpus>>;
let template: string;

beforeAll(async () => {
  anchors = await loadCorpus(join(here, "fixtures", "experience.yaml"));
  template = await readFile(
    join(here, "fixtures", "resume-template.tex"),
    "utf8",
  );
});

function response(overrides: Partial<ManualLLMResponse> = {}): ManualLLMResponse {
  return {
    job: {
      company: "Acme",
      jobTitle: "Senior Rust Engineer",
      jobUrl: "https://boards.greenhouse.io/acme/jobs/1",
      jobDescription:
        "Senior Rust Engineer. Must have async Rust, concurrency, HTTP services.",
    },
    bullets: [
      {
        original: "Built HTTP server in Rust handling 10k req/s",
        revised:
          "Built async Rust HTTP server with high concurrency, handling 10k req/s",
        keywordsAdded: ["async", "concurrency"],
        reasonsForAddition: ["rust-async-http covers async + concurrency"],
      },
    ],
    coverLetterParagraphs: ["I build fast Rust services."],
    formFieldGuidance: [{ fieldId: "whyq", suggestedAnswer: "Systems work." }],
    ...overrides,
  };
}

describe("parseManualResponse", () => {
  it("parses valid JSON and strips a markdown code fence", () => {
    const raw = "```json\n" + JSON.stringify(response()) + "\n```";
    const parsed = parseManualResponse(raw);
    expect(parsed.job.company).toBe("Acme");
    expect(parsed.bullets).toHaveLength(1);
  });

  it("rejects a response without bullets", () => {
    const bad = JSON.stringify({ ...response(), bullets: [] });
    expect(() => parseManualResponse(bad)).toThrow(/bullets/);
  });

  it("rejects non-JSON", () => {
    expect(() => parseManualResponse("Sure! Here's the resume…")).toThrow(
      /not valid JSON/,
    );
  });
});

describe("processManualResponse", () => {
  it("validates corpus-supported rewrites and assembles output", async () => {
    const { output, job } = await processManualResponse(
      response(),
      anchors,
      template,
    );
    expect(job.company).toBe("Acme");
    expect(output.rewritingReport.allInvariantChecksPassed).toBe(true);
    expect(output.resumeLatex).toContain("async Rust HTTP server");
    expect(output.resumeLatex).not.toContain("%%BULLETS%%");
    expect(output.coverLetter).toContain("Acme");
    expect(output.retrievedExperiences[0].anchor.id).toBe("rust-async-http");
    expect(output.formFieldGuidance[0].fieldId).toBe("whyq");
  });

  it("flags hallucinated keywords the corpus does not support", async () => {
    const { output } = await processManualResponse(
      response({
        bullets: [
          {
            original: "Built HTTP server in Rust handling 10k req/s",
            revised:
              "Built Kubernetes-orchestrated Rust HTTP server handling 10k req/s",
            keywordsAdded: ["kubernetes"],
            reasonsForAddition: ["JD mentions k8s"],
          },
        ],
      }),
      anchors,
      template,
    );
    const bullet = output.rewritingReport.perBullet[0];
    expect(bullet.invariantChecksPassed).toBe(false);
    expect(output.rewritingReport.allInvariantChecksPassed).toBe(false);
    expect(bullet.warnings.join(" ")).toMatch(/kubernetes/i);
  });

  it("flags altered metrics", async () => {
    const { output } = await processManualResponse(
      response({
        bullets: [
          {
            original: "Built HTTP server in Rust handling 10k req/s",
            revised: "Built Rust HTTP server handling 50k req/s",
            keywordsAdded: [],
            reasonsForAddition: [],
          },
        ],
      }),
      anchors,
      template,
    );
    const bullet = output.rewritingReport.perBullet[0];
    expect(bullet.invariantChecksPassed).toBe(false);
  });
});
