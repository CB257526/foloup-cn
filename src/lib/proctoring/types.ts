export const PROCTOR_EVENT_TYPES = [
  "phone",
  "absent",
  "multiple_people",
  "looking_away",
] as const;

export type ProctorEventType = (typeof PROCTOR_EVENT_TYPES)[number];
export type ProctorAnalysisStatus = "clear" | "violation" | "uncertain";

export type ProctorAnalysis = {
  status: ProctorAnalysisStatus;
  violationType: ProctorEventType | null;
  confidence: number;
  summary: string;
};

export type ProctorCaptureResult = {
  captureId: number;
  status: ProctorAnalysisStatus | "error";
  strikeCount: number;
  maxStrikes: number;
  event: {
    type: ProctorEventType;
    confidence: number;
    summary: string;
  } | null;
  terminated: boolean;
  consecutiveFailures: number;
  errorCode?: string;
};

export type ProctorSessionSnapshot = {
  enabled: boolean;
  token: string;
  intervalSeconds: number;
  confidenceThreshold: number;
};
