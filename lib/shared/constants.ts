export const BOARD_DETECTION_PATTERNS = {
  linkedin: {
    urlPattern: /linkedin\.com\/jobs\/view\//,
    domSelectors: ["posting-description", "data-job-id"],
    confidence: 0.99,
  },
  indeed: {
    urlPattern: /indeed\.com\/jobs\?/,
    domSelectors: ["jobsearch-JobComponent", "jobsearch-Result"],
    confidence: 0.99,
  },
  greenhouse: {
    urlPattern: /\.greenhouse\.io/,
    domSelectors: ["app-body", "data-department-id"],
    confidence: 0.95,
  },
  lever: {
    urlPattern: /\.lever\.co/,
    domSelectors: ["posting", "data-posting-id"],
    confidence: 0.95,
  },
  ashby: {
    urlPattern: /ashby(hq)?\.com/,
    domSelectors: ["job-posting", "data-job-id"],
    confidence: 0.95,
  },
  workday: {
    urlPattern: /myworkdayjobs\.com/,
    domSelectors: ["data-automation-id"],
    confidence: 0.95,
  },
  icims: {
    urlPattern: /\.icims\.com/,
    domSelectors: ["iCIMS_JobContent", "icims_content_iframe"],
    confidence: 0.95,
  },
  workable: {
    urlPattern: /apply\.workable\.com|jobs\.workable\.com/,
    domSelectors: ['data-ui="job-title"', "whr-embed"],
    confidence: 0.95,
  },
  smartrecruiters: {
    urlPattern: /jobs\.smartrecruiters\.com|careers\.smartrecruiters\.com/,
    domSelectors: ["st-jobDescription", "smartrecruiters"],
    confidence: 0.95,
  },
} as const;

// Living coverage list: board → detector file. Update last-verified when a
// board is manually re-tested against a live posting.
export const BOARD_COVERAGE: Record<
  string,
  { detector: string; lastVerified: string }
> = {
  linkedin: { detector: "detectors/linkedin.ts", lastVerified: "2026-07-03" },
  indeed: { detector: "detectors/indeed.ts", lastVerified: "2026-07-03" },
  greenhouse: { detector: "detectors/greenhouse.ts", lastVerified: "2026-09-28" },
  lever: { detector: "detectors/lever.ts", lastVerified: "2026-09-28" },
  ashby: { detector: "detectors/ashby.ts", lastVerified: "2026-09-28" },
  workday: { detector: "detectors/workday.ts", lastVerified: "2026-07-03" },
  icims: { detector: "detectors/icims.ts", lastVerified: "unverified" },
  workable: { detector: "detectors/workable.ts", lastVerified: "unverified" },
  smartrecruiters: {
    detector: "detectors/smartrecruiters.ts",
    lastVerified: "unverified",
  },
};

// Order matters: the first matching type wins, so specific types precede the
// generic ones that would shadow them (company name before name, LinkedIn
// before website, location before city).
export const FIELD_TYPE_KEYWORDS: Record<string, string[]> = {
  "preferred-name": ["preferred name", "preferred first name", "nickname"],
  "first-name": ["first name", "given name", "forename", "legal first name"],
  "last-name": ["last name", "family name", "surname", "legal last name"],
  email: ["email address", "email", "e-mail"],
  phone: ["phone number", "phone", "contact number", "mobile", "telephone"],
  linkedin: ["linkedin"],
  github: ["github"],
  "cover-letter": ["cover letter"],
  resume: ["resume", "résumé", "cv", "curriculum vitae"],
  sponsorship: ["sponsorship", "sponsor", "require a visa", "visa status"],
  "work-auth": [
    "authorized to work",
    "authorised to work",
    "work authorization",
    "work authorisation",
    "legally eligible",
    "eligible to work",
    "right to work",
    "legally authorized",
  ],
  pronouns: ["pronoun", "pronouns"],
  gender: ["gender", "sex"],
  hispanic: ["hispanic", "latino", "latinx", "latine"],
  race: ["race", "ethnicity", "ethnic background"],
  veteran: ["veteran", "protected veteran", "military service"],
  disability: ["disability", "disabled"],
  "how-heard": [
    "how did you hear",
    "how did you find",
    "where did you hear",
    "how you heard",
    "hear about",
    "heard about",
    "learn about this",
  ],
  "start-date": ["start date", "earliest start", "available to start", "when can you start", "notice period"],
  salary: ["salary", "compensation", "pay expectation", "desired pay", "expected pay"],
  relocate: ["relocate", "relocation", "relocating"],
  "current-company": ["current company", "current employer", "most recent employer", "company name", "employer"],
  "current-title": ["current title", "current job title", "current role", "job title", "title"],
  school: ["school", "university", "college", "institution"],
  degree: ["degree"],
  major: ["major", "field of study", "discipline", "area of study"],
  gpa: ["gpa", "grade point"],
  "grad-date": ["graduation", "grad date", "graduation year", "year of graduation"],
  address: ["street address", "address line", "address 1", "address"],
  location: [
    "current location",
    "location",
    "where are you based",
    "based in",
    "currently located",
    "where are you located",
  ],
  city: ["city", "town"],
  state: ["state", "province", "region"],
  zip: ["zip", "postal"],
  country: ["country"],
  website: ["portfolio", "personal website", "personal site", "website", "url", "link"],
  name: ["full name", "your name", "legal name", "applicant name", "name"],
};

// Types whose questions are often long sentences. Everything else only
// matches short labels, so "Have you worked for this employer before?"
// never becomes current-company.
export const LONG_LABEL_TYPES = new Set([
  "work-auth",
  "sponsorship",
  "pronouns",
  "gender",
  "hispanic",
  "race",
  "veteran",
  "disability",
  "how-heard",
  "start-date",
  "salary",
  "relocate",
  "cover-letter",
  "resume",
]);
export const SHORT_LABEL_MAX = 50;

// HTML autocomplete tokens → value types (the strongest signal when present).
export const AUTOCOMPLETE_TYPES: Record<string, string> = {
  "given-name": "first-name",
  "family-name": "last-name",
  name: "name",
  nickname: "preferred-name",
  email: "email",
  tel: "phone",
  "tel-national": "phone",
  "street-address": "address",
  "address-line1": "address",
  "address-level2": "city",
  "address-level1": "state",
  "postal-code": "zip",
  country: "country",
  "country-name": "country",
  organization: "current-company",
  "organization-title": "current-title",
  url: "website",
};

export const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.85,
  MEDIUM: 0.7,
  LOW: 0.5,
  FALLBACK: 0.3,
} as const;
