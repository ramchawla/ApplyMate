import type { Profile } from "../types";

export const EMPTY_PROFILE: Profile = {
  name: { first: "", last: "", preferred: "" },
  email: "",
  phone: "",
  address: { street: "", city: "", state: "", zip: "", country: "" },
  location: "",
  links: { linkedin: "", github: "", portfolio: "" },
  current: { company: "", title: "" },
  education: { school: "", degree: "", major: "", gpa: "", start: "", end: "" },
  work_auth: { authorized: "", sponsorship: "" },
  start_date: "",
  salary: "",
  relocate: "",
  eeo: { pronouns: "", gender: "", race: "", hispanic: "", veteran: "", disability: "" },
  answers: [],
};

// profile.yaml is hand-edited: coerce every leaf to a string and drop
// malformed answer rules instead of trusting the shape.
export function normalizeProfile(raw: unknown): Profile {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, template] of Object.entries(EMPTY_PROFILE)) {
    const value = src[key];
    if (key === "answers") {
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

export function getProfile(): Promise<Profile> {
  return new Promise((resolve) => {
    chrome.storage.local.get("profile", (result) => resolve(normalizeProfile(result.profile)));
  });
}

export function saveProfile(profile: Profile): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set({ profile }, () => resolve()));
}
