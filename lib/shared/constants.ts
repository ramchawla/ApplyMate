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
    urlPattern: /\.ashby\.com/,
    domSelectors: ["job-posting", "data-job-id"],
    confidence: 0.95,
  },
} as const;

export const FIELD_TYPE_KEYWORDS: Record<string, string[]> = {
  name: ["full name", "your name", "applicant name", "name"],
  email: ["email address", "email"],
  phone: ["phone number", "phone", "contact number"],
  resume: ["resume", "cv", "curriculum vitae"],
  "cover-letter": ["cover letter", "cover"],
  "custom-q": ["why", "interested", "interest", "tell us", "describe"],
};

export const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.85,
  MEDIUM: 0.7,
  LOW: 0.5,
  FALLBACK: 0.3,
} as const;
