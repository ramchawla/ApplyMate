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
  present: { keyword: string; where: string }[];
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
  runId: string;
  labels: Record<string, string>;
  questions: TailorQuestion[];
  // Applied changes within this run (0 = the tailoring output).
  version: number;
}

// ---- Run folders (~/.applymate/applications/<dir>/) ----

// report.json: what the tailoring run produced; never rewritten by chat.
export interface RunFile {
  applicationId: string;
  runId: string;
  createdAt: string;
  job: { title: string; company: string; url: string };
  fileName: string;
  wantCoverLetterPdf: boolean;
  labels: Record<string, string>;
  questions: TailorQuestion[];
  keywords: KeywordReport;
  edits: EditRecord[];
  warnings: string[];
  pages: number;
}

// state.json: the current overlay on master.tex that chat edits.
export interface RunState {
  edits: Record<string, string>;
  order: Record<string, string[]>;
  coverLetter: string;
  answers: Record<string, string>;
  questions: TailorQuestion[];
  version: number;
}

export interface Proposal {
  target: string;
  label: string;
  before: string;
  after: string;
  why: string;
  warnings: string[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  proposals?: Proposal[];
  applied?: number[];
  at: number;
}

// One NDJSON line of a streamed chat turn (POST /chat/:runId).
export type ChatEvent =
  | { t: "delta"; text: string }
  | { t: "done"; message: ChatMessage }
  | { t: "error"; message: string };

export type ApplyResult = { ok: true; state: RunState; version: number } | { ok: false; reason: string };

export interface RunReport {
  url: string;
  title: string;
  company: string;
  jdSource: string;
  filled: number;
  needsYou: string[];
  // Wizard progress: steps visited and why the run stopped.
  steps: number;
  stoppedAt: "review" | "needs-you" | "errors" | "no-button" | "max-steps" | "done" | "closed" | "sign-in";
  errors?: string[];
  result?: TailorResult;
  error?: string;
  at: number;
}
