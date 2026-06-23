export const REVIEW_SCRUTINY_ARTIFACT = "review-scrutiny.json";
export const REVIEW_SCRUTINY_SCHEMA_VERSION = 2;

export const CRITIC_REVIEW_ARTIFACT = "critic-review.json";
export const SEMANTIC_GATE_REVIEW_ARTIFACT = "semantic-gate-review.json";
export const PROGRESS_REVIEW_ARTIFACT = "progress-review.json";

export type ReviewSurface =
  | "critic"
  | "progress-reviewer"
  | "pr-reviewer"
  | "semantic-gate";

export const SUPPORTED_REVIEW_SURFACES: ReviewSurface[] = [
  "critic",
  "progress-reviewer",
  "pr-reviewer",
  "semantic-gate",
];

export type ReviewDecision =
  | "pass"
  | "pass_with_warnings"
  | "fail"
  | "on-track"
  | "needs-steering"
  | "blocked"
  | "insufficient-evidence"
  | "approve"
  | "request-changes";

export const REVIEW_SCRUTINY_METRICS = [
  "evidenceIdCount",
  "findingCount",
  "issueCount",
  "warningCount",
  "followUpTaskCount",
  "reviewBodyLength",
  "citedFileLineCount",
] as const;

export type ReviewScrutinyMetric = (typeof REVIEW_SCRUTINY_METRICS)[number];
export type ReviewScrutinySignals = Partial<Record<ReviewScrutinyMetric, number>>;

export type ReviewScrutinyRecord = {
  schemaVersion: typeof REVIEW_SCRUTINY_SCHEMA_VERSION;
  surface: ReviewSurface;
  runId: string;
  workflow: string;
  generatedAt: string;
  artifact: string;
  reviewerPromptHash?: string;
  taskId?: string;
  pr?: { repo: string; number: number };
  decision: ReviewDecision;
  signals: ReviewScrutinySignals;
  absentMetrics: ReviewScrutinyMetric[];
  thinAcceptance: boolean;
};

export type ReviewScrutinyUnsupportedArtifact = {
  runId: string;
  workflow: string;
  artifact: string;
  reason: string;
};

export type ReviewScrutinyReport = {
  totalReviews: number;
  approvalLikeDecisions: number;
  thinAcceptances: number;
  absentMetricCount: number;
  unsupportedArtifacts: number;
  bySurface: {
    surface: ReviewSurface;
    reviews: number;
    approvalLikeDecisions: number;
    thinAcceptances: number;
    absentMetricCount: number;
    unsupportedArtifacts: number;
  }[];
  thinAcceptanceRefs: {
    runId: string;
    workflow: string;
    surface: ReviewSurface;
    decision: ReviewDecision;
    artifact: string;
    taskId?: string;
    pr?: { repo: string; number: number };
  }[];
  absentMetricRefs: {
    runId: string;
    workflow: string;
    surface: ReviewSurface;
    artifact: string;
    metrics: ReviewScrutinyMetric[];
    taskId?: string;
    pr?: { repo: string; number: number };
  }[];
  records: ReviewScrutinyRecord[];
  unsupported: ReviewScrutinyUnsupportedArtifact[];
};

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue | undefined };

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

export function numberValue(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function stringArray(value: JsonValue | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function objectArray(value: JsonValue | undefined): JsonObject[] {
  return Array.isArray(value) ? value.filter(isJsonObject) : [];
}

export function isApprovalLikeDecision(decision: ReviewDecision): boolean {
  return (
    decision === "pass" ||
    decision === "pass_with_warnings" ||
    decision === "on-track" ||
    decision === "approve"
  );
}
