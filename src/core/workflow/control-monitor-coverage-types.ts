export const CONTROL_MONITOR_COVERAGE_ARTIFACT =
  "control-monitor-coverage.json";
export const CONTROL_MONITOR_COVERAGE_SCHEMA_VERSION = 1;

export const CONTENT_INGEST_TOOL_NAMES = new Set([
  "WebFetch",
  "WebSearch",
  "web_fetch",
  "web_search",
  "http_request",
  "read_document",
  "browser_get_text",
  "x_post_read",
  "rendered_article_read",
]);

export const ASYNC_REVIEW_ARTIFACTS = [
  "critic-review.json",
  "security-review-outcome.json",
  "progress-review.json",
  "autonomy-health-review.json",
  "workflow-failure-escalation.json",
  "trajectory-diagnostic-escalation.json",
];

export type ControlCoverageFamilyName =
  | "agent-step-stream"
  | "autonomy-mode"
  | "tool-policy"
  | "injection-defense"
  | "approval-owner-gates"
  | "runtime-probe"
  | "token-budget"
  | "trajectory-diagnostics"
  | "async-reviewers";

export type ControlCoverageStatus =
  | "covered"
  | "partial"
  | "missing"
  | "unsupported"
  | "pending"
  | "not-applicable";

export type ControlCoverageGap = {
  id: string;
  family: ControlCoverageFamilyName;
  severity: "warning" | "error";
  reason: string;
  subject: string;
  evidenceRefs: string[];
};

export type ControlCoverageFamily = {
  family: ControlCoverageFamilyName;
  status: ControlCoverageStatus;
  numerator: number;
  denominator: number;
  pending: number;
  blocked: number;
  warned: number;
  evidenceRefs: string[];
  gapIds: string[];
};

export type ControlCoverageFamilyBuilder = Omit<
  ControlCoverageFamily,
  "status"
> & {
  unsupported: number;
};

export type ControlMonitorCoverageArtifact = {
  schemaVersion: typeof CONTROL_MONITOR_COVERAGE_SCHEMA_VERSION;
  generatedAt: string;
  artifactPath: string;
  run: {
    id: string;
    workflow: string;
    triggerEvent: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    headSha: string | null;
  };
  monitoredSurfaceCounts: {
    agentSteps: number;
    toolCalls: number;
    externalPayloadIngests: number;
    approvalRequests: number;
    ownerQuestionWaits: number;
    daemonHostControlDenials: number;
    runtimeProbes: number;
    postRunReviewLinks: number;
  };
  summary: {
    numerator: number;
    denominator: number;
    gapCount: number;
    unsupportedCount: number;
    pendingCount: number;
    blockedCount: number;
    warnedCount: number;
  };
  families: ControlCoverageFamily[];
  gaps: ControlCoverageGap[];
  asyncReviewResponseMs: {
    observations: number;
    min: number | null;
    max: number | null;
    average: number | null;
  };
};
