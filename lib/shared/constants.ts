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
  greenhouse: { detector: "detectors/greenhouse.ts", lastVerified: "2026-07-03" },
  lever: { detector: "detectors/lever.ts", lastVerified: "2026-07-03" },
  ashby: { detector: "detectors/ashby.ts", lastVerified: "2026-07-03" },
  workday: { detector: "detectors/workday.ts", lastVerified: "2026-07-03" },
  icims: { detector: "detectors/icims.ts", lastVerified: "unverified" },
  workable: { detector: "detectors/workable.ts", lastVerified: "unverified" },
  smartrecruiters: {
    detector: "detectors/smartrecruiters.ts",
    lastVerified: "unverified",
  },
};

// Order matters: matching walks these entries top-down, so more specific
// value types (first/last name, linkedin before generic website/url) must
// precede the generic ones they'd otherwise be shadowed by.
export const FIELD_TYPE_KEYWORDS: Record<string, string[]> = {
  "first-name": ["first name", "given name", "forename"],
  "last-name": ["last name", "family name", "surname"],
  name: ["full name", "your name", "applicant name", "name"],
  email: ["email address", "email", "e-mail"],
  phone: ["phone number", "phone", "contact number", "mobile"],
  linkedin: ["linkedin"],
  github: ["github"],
  website: ["portfolio", "personal website", "personal site", "website", "url"],
  location: ["current location", "location", "city", "where are you based"],
  "work-auth": [
    "authorized to work",
    "authorised to work",
    "work authorization",
    "work authorisation",
    "require sponsorship",
    "visa sponsorship",
    "sponsorship",
    "legally eligible",
  ],
  salary: [
    "salary expectation",
    "expected salary",
    "desired salary",
    "compensation expectation",
    "expected compensation",
    "salary",
  ],
  resume: ["resume", "cv", "curriculum vitae"],
  "cover-letter": ["cover letter", "cover"],
  "custom-q": ["why", "interested", "interest", "tell us", "describe"],
};

// Everything the side panel lets a user assign to a field. Derived from the
// keyword table so the dropdown and the mapper can't drift apart.
export const VALUE_TYPES = [...Object.keys(FIELD_TYPE_KEYWORDS), "unknown"];

export const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.85,
  MEDIUM: 0.7,
  LOW: 0.5,
  FALLBACK: 0.3,
} as const;
