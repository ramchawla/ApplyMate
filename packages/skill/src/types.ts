export interface ParsedJD {
  keywords: string[];
  hardSkills: string[];
  seniority: "junior" | "mid" | "senior" | "staff" | "unknown";
  yearsRequired: number | null;
  techStack: string[];
  mustHaves: string[];
  niceToHaves: string[];
}

export interface ExperienceAnchor {
  id: string;
  title: string;
  description: string;
  skills: string[];
  metrics: string[];
  tags: string[];
  claimAnchor: string;
}
