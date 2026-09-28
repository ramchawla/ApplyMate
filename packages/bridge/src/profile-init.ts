import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";

const DECLINE = "Decline to self-identify";

export const PROFILE_HEADER = `# ApplyMate profile — used to autofill applications instantly.
# answers: first rule whose "match" (case-insensitive regex) hits a question label wins.
`;

export function buildProfile(
  corpusYaml: string,
  masterTex: string,
): Record<string, unknown> {
  const doc = (parse(corpusYaml) ?? {}) as { profile?: Record<string, unknown> };
  const p = doc.profile ?? {};
  const [first = "", ...rest] = String(p.name ?? "").trim().split(/\s+/);
  const hrefs = [...masterTex.matchAll(/\\href\{([^}]+)\}/g)].map((m) => m[1]);
  const find = (re: RegExp) => hrefs.find((h) => re.test(h)) ?? "";
  const edu = masterTex.match(
    /\\section\{Education\}[\s\S]*?\\resumeSubheading\s*\{([^}]*)\}\{([^}]*)\}/,
  );
  const years = edu?.[2].match(/(\d{4})\D+(\d{4})/);

  return {
    name: { first, last: rest.join(" "), preferred: first },
    email: String(p.email ?? ""),
    phone: "",
    address: { street: "", city: "", state: "", zip: "", country: "" },
    location: "",
    links: {
      linkedin: find(/linkedin\.com/),
      github: find(/github\.com/),
      portfolio: hrefs.find((h) => !/^mailto:|linkedin\.com|github\.com/.test(h)) ?? "",
    },
    current: {
      company: String(p.org ?? "").split(/\s+[—–-]\s+/)[0],
      title: String(p.current_title ?? ""),
    },
    education: {
      school: edu?.[1].trim() ?? "",
      degree: "",
      major: masterTex.match(/\\textbf\{([^}]+)\}\s*\(major\)/)?.[1] ?? "",
      gpa: "",
      start: years?.[1] ?? "",
      end: years?.[2] ?? "",
    },
    work_auth: { authorized: "", sponsorship: "" },
    start_date: "",
    salary: "",
    relocate: "",
    eeo: {
      pronouns: "",
      gender: DECLINE,
      race: DECLINE,
      hispanic: DECLINE,
      veteran: DECLINE,
      disability: DECLINE,
    },
    answers: [
      { match: "how (did )?you (hear|heard|find|found|learn)", answer: "LinkedIn" },
      { match: "previously (worked|been employed)", answer: "No" },
    ],
  };
}

if (process.argv[1]?.endsWith("profile-init.ts")) {
  const dir = process.env.APPLYMATE_DIR ?? join(homedir(), ".applymate");
  const out = join(dir, "profile.yaml");
  if (existsSync(out)) {
    console.log(`${out} already exists — leaving it untouched.`);
  } else {
    const read = (f: string) => {
      try {
        return readFileSync(join(dir, f), "utf8");
      } catch {
        return "";
      }
    };
    writeFileSync(
      out,
      PROFILE_HEADER + stringify(buildProfile(read("experience.yaml"), read("resume-master.tex"))),
    );
    console.log(`Wrote ${out}. Fill in phone, address, work_auth, start_date, salary.`);
  }
}
