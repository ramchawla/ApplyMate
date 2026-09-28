export type {
  FormField,
  DetectionResult,
  TailorRequest,
  TailorResult,
  TailorQuestion,
  RunReport,
} from "../../../lib/shared/types";

export interface Profile {
  name: { first: string; last: string; preferred: string };
  email: string;
  phone: string;
  address: { street: string; city: string; state: string; zip: string; country: string };
  location: string;
  links: { linkedin: string; github: string; portfolio: string };
  current: { company: string; title: string };
  education: {
    school: string;
    degree: string;
    major: string;
    gpa: string;
    start: string;
    end: string;
  };
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
