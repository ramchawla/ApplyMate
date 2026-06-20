import type { FormField } from "../../../lib/shared/types";

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

export interface RetrievedExperience {
  anchor: ExperienceAnchor;
  relevanceScore: number;
}

export interface BulletRewrite {
  original: string;
  revised: string;
  keywordsAdded: string[];
  metricsPreserved: string[];
  reasonsForAddition: string[];
  invariantChecksPassed: boolean;
  plausibilityScore: number;
  validationNotes: string[];
  warnings: string[];
}

export interface RewritingReport {
  totalBullets: number;
  bulletsModified: number;
  totalKeywordsAdded: number;
  perBullet: BulletRewrite[];
  summary: string;
  overallConfidence: number;
  warnings: string[];
  recommendations: string[];
  allInvariantChecksPassed: boolean;
}

export interface ApplyJobInput {
  jobDescription: string;
  jobTitle: string;
  company: string;
  jobUrl: string;
  formFields: FormField[];
  manualContext?: string;
}

export interface ApplyJobOutput {
  parsedJD: ParsedJD;
  retrievedExperiences: RetrievedExperience[];
  resumeLatex: string;
  coverLetter: string;
  rewritingReport: RewritingReport;
  formFieldGuidance: {
    fieldId: string;
    suggestedAnswer: string;
    relatedBullets: string[];
  }[];
  reasoning: string;
}
