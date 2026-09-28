import type { EducationEntry, Profile, WorkEntry } from "../types";

export const EMPTY_PROFILE: Profile = {
  name: { first: "", last: "", preferred: "" },
  email: "",
  phone: "",
  address: { street: "", city: "", state: "", zip: "", country: "" },
  location: "",
  links: { linkedin: "", github: "", portfolio: "" },
  current: { company: "", title: "" },
  work: [],
  education: [],
  skills: [],
  languages: [],
  work_auth: { authorized: "", sponsorship: "" },
  start_date: "",
  salary: "",
  relocate: "",
  eeo: { pronouns: "", gender: "", race: "", hispanic: "", veteran: "", disability: "" },
  answers: [],
};

// profile.yaml is hand-edited: coerce every leaf to a string and drop
// malformed answer rules instead of trusting the shape.
const WORK_KEYS: (keyof WorkEntry)[] = ["company", "title", "location", "start", "end", "current", "description"];
const EDU_KEYS: (keyof EducationEntry)[] = ["school", "degree", "major", "gpa", "start", "end"];
const leaf = (v: unknown) => (v == null || v === false ? "" : String(v));

// A list of entries; a single object (the old `education:` shape) is a
// one-entry list. All-empty entries are dropped.
function entries(v: unknown, keys: string[]): Record<string, string>[] {
  return (Array.isArray(v) ? v : v && typeof v === "object" ? [v] : [])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === "object" && !Array.isArray(e))
    .map((e) => Object.fromEntries(keys.map((k) => [k, leaf(e[k])])))
    .filter((e) => Object.values(e).some(Boolean));
}
const strings = (v: unknown) =>
  (Array.isArray(v) ? v : []).filter((x) => x != null && typeof x !== "object").map(String).filter(Boolean);

export function normalizeProfile(raw: unknown): Profile {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, template] of Object.entries(EMPTY_PROFILE)) {
    const value = src[key];
    if (key === "work") out.work = entries(value, WORK_KEYS);
    else if (key === "education") out.education = entries(value, EDU_KEYS);
    else if (key === "skills" || key === "languages") out[key] = strings(value);
    else if (key === "answers") {
      out.answers = (Array.isArray(value) ? value : [])
        .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
        .map((r) => ({ match: String(r.match ?? ""), answer: String(r.answer ?? "") }))
        .filter((r) => r.match);
    } else if (typeof template === "string") {
      out[key] = value == null ? "" : String(value);
    } else {
      const nested = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
      out[key] = Object.fromEntries(
        Object.keys(template as object).map((k) => [
          k,
          nested[k] == null ? "" : String(nested[k]),
        ]),
      );
    }
  }
  return out as unknown as Profile;
}
