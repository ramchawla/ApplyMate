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
}
