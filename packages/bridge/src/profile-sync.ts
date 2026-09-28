import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseDocument } from "yaml";
import { runClaude, type ClaudeRunner } from "../../skill/src/tailor/claude-cli";
import { normalizeProfile } from "../../extension/src/lib/profile-shape";
import type { Profile } from "../../extension/src/types";

export type ProfileLists = Pick<Profile, "work" | "education" | "skills" | "languages">;
const LIST_KEYS = ["work", "education", "skills", "languages"] as const;

const SYSTEM = `You extract one candidate's work history, education, skills and spoken languages from their LaTeX resume and experience corpus. Respond only through the structured output schema.
- Plain text only: no LaTeX commands, no markdown.
- Most recent first. Dates as YYYY-MM when the month is known, else YYYY. end is "" and current is true only for a role still held.
- description: 1-3 plain sentences summarising that role's resume bullets, keeping their numbers.
- Copy facts exactly. Never invent employers, titles, dates, degrees, grades or skills. Unknown fields are "".
- skills: technologies and tools the resume or corpus shows, most prominent first. languages: spoken languages only (English if nothing else is stated).`;

const str = { type: "string" } as const;
const obj = (props: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(props),
  properties: props,
});
const SCHEMA = obj({
  work: {
    type: "array",
    items: obj({ company: str, title: str, location: str, start: str, end: str, current: { type: "boolean" }, description: str }),
  },
  education: { type: "array", items: obj({ school: str, degree: str, major: str, gpa: str, start: str, end: str }) },
  skills: { type: "array", items: str },
  languages: { type: "array", items: str },
});

export async function extractProfileLists(
  runner: ClaudeRunner,
  masterTex: string,
  corpusYaml: string,
  cwd?: string,
): Promise<ProfileLists> {
  const raw = await runner({
    system: SYSTEM,
    prompt: `# Resume (LaTeX)\n${masterTex}\n\n# Experience corpus\n${corpusYaml.trim() || "(none)"}`,
    schema: SCHEMA,
    cwd,
  });
  const p = normalizeProfile(raw);
  return { work: p.work, education: p.education, skills: p.skills, languages: p.languages };
}

const isBlank = (v: unknown): boolean =>
  v == null ||
  v === "" ||
  (Array.isArray(v) ? v.length === 0 : typeof v === "object" && Object.values(v).every(isBlank));

// Fills only lists the user hasn't written; comments and every other key
// survive (Document API, not parse/stringify).
export function mergeProfileLists(profileYaml: string, lists: ProfileLists): string {
  const doc = parseDocument(profileYaml);
  const current = (doc.toJS() ?? {}) as Record<string, unknown>;
  for (const key of LIST_KEYS) {
    if (isBlank(current[key]) && lists[key].length) doc.set(key, lists[key]);
  }
  return doc.toString();
}

if (process.argv[1]?.endsWith("profile-sync.ts")) {
  const dir = process.env.APPLYMATE_DIR ?? join(homedir(), ".applymate");
  const read = (f: string) => {
    try {
      return readFileSync(join(dir, f), "utf8");
    } catch {
      return "";
    }
  };
  const profilePath = join(dir, "profile.yaml");
  const profileYaml = read("profile.yaml");
  if (!profileYaml) {
    console.error(`${profilePath} not found — run \`pnpm profile:init\` first.`);
    process.exit(1);
  }
  console.log("Asking Claude (subscription, claude -p) to extract work/education/skills…");
  extractProfileLists(runClaude, read("resume-master.tex"), read("experience.yaml"), dir).then(
    (lists) => {
      const merged = mergeProfileLists(profileYaml, lists);
      if (merged === profileYaml) {
        console.log("All lists already filled — nothing changed.");
        return;
      }
      writeFileSync(profilePath, merged);
      console.log(
        `Updated ${profilePath}: ${lists.work.length} jobs, ${lists.education.length} schools, ${lists.skills.length} skills (only empty lists were filled). Review it.`,
      );
    },
    (err: Error) => {
      console.error(`profile:sync failed: ${err.message}`);
      process.exit(1);
    },
  );
}
