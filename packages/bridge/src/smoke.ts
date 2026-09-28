// Real end-to-end check: real `claude -p` + real tectonic on your real files.
// Usage: pnpm tailor:smoke [path/to/jd.txt]
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { makeTailorJob } from "./tailor-job";

const SAMPLE_JD = `Senior Platform Engineer. Build internal developer platforms on Kubernetes,
own CI/CD (GitHub Actions), infrastructure as code (Terraform), observability, and
secure service-to-service auth. 5+ years. Bonus: LLM tooling and MCP.`;

const dir = process.env.APPLYMATE_DIR ?? join(homedir(), ".applymate");
const description = process.argv[2] ? await readFile(process.argv[2], "utf8") : SAMPLE_JD;
const started = Date.now();
const { result } = await makeTailorJob({ dir })({
  job: {
    title: "Senior Platform Engineer",
    company: "SmokeTest",
    url: "https://example.com/smoke",
    description,
  },
  keywords: ["terraform", "kubernetes"],
  fields: [
    { fieldId: "why", label: "Why do you want to work here?", type: "textarea", required: true },
    {
      fieldId: "auth",
      label: "Are you legally authorized to work in Canada?",
      type: "select",
      options: ["Yes", "No"],
      required: true,
    },
  ],
  wantCoverLetterPdf: true,
});
console.log(
  `done in ${Math.round((Date.now() - started) / 1000)}s — ${result.pages} page(s) → ${result.savedTo}`,
);
console.log(`edits: ${result.edits.length} (${result.edits.filter((e) => e.reverted).length} reverted)`);
console.log(
  `injected: ${result.keywords.injected.map((k) => `${k.keyword}@${k.where}`).join(", ") || "-"}`,
);
console.log(
  `skipped: ${result.keywords.skipped.map((k) => `${k.keyword} (${k.reason})`).join("; ") || "-"}`,
);
for (const w of result.warnings) console.log(`warn: ${w}`);
for (const a of result.answers) console.log(`answer ${a.fieldId}: ${a.value}`);
if (result.pages !== 1) process.exit(1);
