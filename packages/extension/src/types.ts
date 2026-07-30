export type {
  ExtractedJobData,
  FormField,
  DetectionResult,
} from "../../../lib/shared/types";

export interface MessageFromContent {
  type: "JOB_EXTRACTED" | "ERROR" | "OPEN_SIDE_PANEL";
  data?: unknown;
  error?: string;
}

export interface MessageFromBackground {
  type: "OPEN_CLAUDE_CODE" | "APPLY_JOB_OUTPUT_RECEIVED";
  data?: unknown;
}

export interface SidePanelState {
  extractedJobData?: import("../../../lib/shared/types").ExtractedJobData;
  currentTab:
    | "data-review"
    | "form-validation"
    | "tailoring-review"
    | "form-auto-fill";
  isLoading: boolean;
  approvedOutput?: {
    coverLetter: string;
    formFieldGuidance: { fieldId: string; suggestedAnswer: string }[];
  };
}

export interface Profile {
  fullName: string;
  email: string;
  phone: string;
  linkedin: string;
  github: string;
  website: string;
  location: string;
  workAuthorization: string;
  salaryExpectation: string;
}

export interface FillInstruction {
  fieldId: string;
  valueType: string;
  value: string;
  isFile: boolean;
}

export interface FillPlan {
  instructions: FillInstruction[];
  unmappedFieldIds: string[];
}

export interface ApplyFillPlanMessage {
  type: "APPLY_FILL_PLAN";
  instructions: FillInstruction[];
  highlightFieldIds?: string[];
}
