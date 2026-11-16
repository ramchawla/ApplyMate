export type {
  FormField,
  DetectionResult,
  TailorRequest,
  TailorResult,
  TailorQuestion,
  RunReport,
} from "../../../lib/shared/types";

// Side panel → tab (every frame): push an applied chat change into the page.
export type PageSyncMsg =
  | { type: "REATTACH_RESUME"; runId: string; fileName: string; version: number }
  | { type: "REFILL_ANSWER"; label: string; value: string }
  | { type: "REFILL_COVER_LETTER"; runId: string; text: string; hasPdf: boolean; fileName: string };

export interface WorkEntry {
  company: string;
  title: string;
  location: string;
  start: string;
  end: string;
  current: string; // "true" or ""
  description: string;
}

export interface EducationEntry {
  school: string;
  degree: string;
  major: string;
  gpa: string;
  start: string;
  end: string;
}

export interface Profile {
  name: { first: string; last: string; preferred: string };
  email: string;
  phone: string;
  address: { street: string; city: string; state: string; zip: string; country: string };
  location: string;
  links: { linkedin: string; github: string; portfolio: string };
  current: { company: string; title: string };
  // Most recent first. Lists feed wizard "Add" sections (Workday) and back
  // the single-value company/title/school questions.
  work: WorkEntry[];
  education: EducationEntry[];
  skills: string[];
  languages: string[];
  work_auth: { authorized: string; sponsorship: string };
  start_date: string;
  salary: string;
  relocate: string;
  eeo: {
    pronouns: string;
    gender: string;
    race: string;
    hispanic: string;
    veteran: string;
    disability: string;
  };
  answers: { match: string; answer: string }[];
}
