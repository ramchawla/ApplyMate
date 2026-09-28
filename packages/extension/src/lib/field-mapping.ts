import type { FormField, Profile } from "../types";
import type { FillInstruction } from "../content/fill";

const GETTERS: Record<string, (p: Profile) => string> = {
  "first-name": (p) => p.name.first,
  "last-name": (p) => p.name.last,
  "preferred-name": (p) => p.name.preferred || p.name.first,
  name: (p) => `${p.name.first} ${p.name.last}`.trim(),
  email: (p) => p.email,
  phone: (p) => p.phone,
  address: (p) => p.address.street,
  city: (p) => p.address.city,
  state: (p) => p.address.state,
  zip: (p) => p.address.zip,
  country: (p) => p.address.country,
  location: (p) => p.location || [p.address.city, p.address.state].filter(Boolean).join(", "),
  linkedin: (p) => p.links.linkedin,
  github: (p) => p.links.github,
  website: (p) => p.links.portfolio,
  "current-company": (p) => p.current.company,
  "current-title": (p) => p.current.title,
  school: (p) => p.education.school,
  degree: (p) => p.education.degree,
  major: (p) => p.education.major,
  gpa: (p) => p.education.gpa,
  "grad-date": (p) => p.education.end,
  "work-auth": (p) => p.work_auth.authorized,
  sponsorship: (p) => p.work_auth.sponsorship,
  "start-date": (p) => p.start_date,
  salary: (p) => p.salary,
  relocate: (p) => p.relocate,
  pronouns: (p) => p.eeo.pronouns,
  gender: (p) => p.eeo.gender,
  race: (p) => p.eeo.race,
  hispanic: (p) => p.eeo.hispanic,
  veteran: (p) => p.eeo.veteran,
  disability: (p) => p.eeo.disability,
};

export function ruleAnswer(label: string, rules: Profile["answers"]): string | null {
  for (const r of rules) {
    let hit: boolean;
    try {
      hit = new RegExp(r.match, "i").test(label);
    } catch {
      hit = label.toLowerCase().includes(r.match.toLowerCase());
    }
    if (hit) return r.answer;
  }
  return null;
}

export function profileValue(field: FormField, profile: Profile): string | null {
  const rule = ruleAnswer(field.label, profile.answers);
  if (rule !== null) return rule;
  const type = field.userSelectedValueType ?? field.extractedValueType;
  const value = type ? GETTERS[type]?.(profile).trim() : "";
  return value ? value : null;
}

const MAX_PENDING = 40;

// Instant values come from the profile; everything else (custom questions,
// unmapped dropdowns) goes to Claude with the tailoring request. File inputs
// are handled by the attach step.
export function buildInstantPlan(
  fields: FormField[],
  profile: Profile,
): { instructions: FillInstruction[]; pending: FormField[] } {
  const instructions: FillInstruction[] = [];
  const pending: FormField[] = [];
  for (const f of fields) {
    if (f.type === "file") continue;
    const value = profileValue(f, profile);
    if (value !== null) instructions.push({ fieldId: f.id, value });
    else if (pending.length < MAX_PENDING) pending.push(f);
  }
  return { instructions, pending };
}
