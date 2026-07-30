// Manual LLM path: validate + assemble + publish a response pasted back from
// Claude in the browser (Pro subscription — no API, no cost).
//
// Usage:
//   pnpm skill:manual <response.json>
//
// Where <response.json> is the JSON Claude produced from the prompt copied
// out of the extension side panel ("Copy Claude prompt" button).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  parseManualResponse,
  processManualResponse,
} from "../manual/process";
import { loadCorpus } from "../corpus/load";

const APPLYMATE_DIR = process.env.APPLYMATE_DIR ?? join(homedir(), ".applymate");
const BRIDGE_URL = process.env.APPLYMATE_BRIDGE_URL ?? "http://127.0.0.1:4179";

async function main(): Promise<void> {
  const responsePath = process.argv[2];
  if (!responsePath) {
    console.error("Usage: pnpm skill:manual <response.json>");
    process.exit(1);
  }

  const raw = await readFile(responsePath, "utf8");
  const response = parseManualResponse(raw);

  const anchors = await loadCorpus(join(APPLYMATE_DIR, "experience.yaml"));
  const template = await readFile(
    join(APPLYMATE_DIR, "resume-template.tex"),
    "utf8",
  );

  const { output, job } = await processManualResponse(
    response,
    anchors,
    template,
  );

  const report = output.rewritingReport;
  console.log(`\n=== Validation report — ${job.jobTitle} @ ${job.company} ===`);
  console.log(report.summary);
  for (const b of report.perBullet) {
    const mark = b.invariantChecksPassed ? "✓" : "✗";
    console.log(
      `  ${mark} [${Math.round(b.plausibilityScore * 100)}%] ${b.revised.slice(0, 80)}`,
    );
    for (const w of b.warnings) console.log(`      ⚠ ${w}`);
  }
  for (const rec of report.recommendations) console.log(`  → ${rec}`);

  if (!report.allInvariantChecksPassed) {
    console.log(
      "\n⚠ Some bullets FAILED invariant checks. They are included with " +
        "warnings — review them in the side panel before using the resume.",
    );
  }

  // Persist locally regardless of bridge availability.
  const outDir = join(APPLYMATE_DIR, "outputs");
  await mkdir(outDir, { recursive: true });
  const outPath = join(outDir, `manual-${Date.now()}.json`);
  const payload = {
    ...output,
    jobUrl: job.jobUrl,
    company: job.company,
    jobTitle: job.jobTitle,
    jobDescription: job.jobDescription,
  };
  await writeFile(outPath, JSON.stringify(payload, null, 2));
  console.log(`\nSaved output: ${outPath}`);

  // Publish to the bridge so the extension side panel picks it up.
  let token = "";
  try {
    token = (await readFile(join(APPLYMATE_DIR, "bridge-token"), "utf8")).trim();
  } catch {
    // Bridge never started; posting below will fail with guidance.
  }

  try {
    const res = await fetch(`${BRIDGE_URL}/output`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`bridge responded ${res.status}`);
    console.log(
      "Published to bridge — open the extension side panel (Tailoring Review).",
    );
  } catch (err) {
    console.log(
      `Could not reach the bridge (${String(err)}). Start it with 'pnpm bridge' ` +
        `and re-run: pnpm skill:manual ${responsePath}`,
    );
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
