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
    | "unknown";
  placeholder?: string;
  required: boolean;
  extractedValueType?:
    | "name"
    | "first-name"
    | "last-name"
    | "email"
    | "phone"
    | "linkedin"
    | "github"
    | "website"
    | "location"
    | "work-auth"
    | "salary"
    | "resume"
    | "cover-letter"
    | "custom-q"
    | null;
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
