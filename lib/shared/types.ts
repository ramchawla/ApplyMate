export interface FormField {
  id: string;
  label: string;
  type:
    | "text"
    | "email"
    | "tel"
    | "textarea"
    | "select"
    | "file"
    | "checkbox"
    | "radio"
    | "combobox"
    | "date"
    | "number"
    | "url"
    | "unknown";
  placeholder?: string;
  // Helper text linked via aria-describedby ("great answers are 200-400 words").
  description?: string;
  required: boolean;
  extractedValueType?: string | null;
  options?: string[];
  matchConfidence: number;
  userSelectedValueType?: string;
  userProvidedValue?: string;
  validated: boolean;
}

export interface DetectionResult {
  board:
    | "linkedin"
    | "indeed"
    | "greenhouse"
    | "lever"
    | "ashby"
    | "workday"
    | "icims"
    | "workable"
    | "smartrecruiters"
    | "generic"
    | "unknown";
  confidence: number;
  method: "url_pattern" | "dom_structure" | "fallback";
  detectedElements: {
    jdContainer?: string;
    formContainer?: string;
    companyElement?: string;
    jobTitleElement?: string;
  };
}

export interface ExtractedJobData {
  id: string;
  url: string;
  timestamp: string;
  board: string;
  boardConfidence: number;
  jobTitle: string;
  company: string;
  jobDescription: string;
  formFields: FormField[];
  userValidated: boolean;
  userNotes?: string;
}

// ---- One-click tailoring (extension ⇄ bridge) ----

export interface TailorQuestion {
  fieldId: string;
  label: string;
  type: string;
  options?: string[];
  required: boolean;
}

export interface TailorRequest {
  job: { title: string; company: string; url: string; description: string };
  keywords: string[];
  fields: TailorQuestion[];
  wantCoverLetterPdf: boolean;
}

export interface KeywordReport {
  injected: { keyword: string; where: string }[];
  skipped: { keyword: string; reason: string }[];
}

export interface EditRecord {
  id: string;
  before: string;
  after: string;
  reverted?: string;
}

export interface TailorResult {
  applicationId: string;
  fileName: string;
  coverLetter: string;
  hasCoverLetterPdf: boolean;
  answers: { fieldId: string; value: string }[];
  keywords: KeywordReport;
  edits: EditRecord[];
  warnings: string[];
  pages: number;
  savedTo: string;
}

export interface RunReport {
  url: string;
  title: string;
  company: string;
  jdSource: string;
  filled: number;
  needsYou: string[];
  result?: TailorResult;
  error?: string;
  at: number;
}
