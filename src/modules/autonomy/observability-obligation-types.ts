export const OBSERVABILITY_OBLIGATION_WARNING_TYPE = "observability-obligation";
export const OBSERVABILITY_OBLIGATION_REVIEW_ARTIFACT =
  "observability-obligation-review.json";
export const OBSERVABILITY_OBLIGATION_RATIONALE_ARTIFACT =
  "observability-obligation-rationale.json";

export type ObservabilitySensitivityReasonKind =
  | "error-handling"
  | "retry-recovery"
  | "external-call"
  | "tool-execution"
  | "approval-permission"
  | "channel-delivery"
  | "daemon-route"
  | "workflow-step-transition"
  | "agent-harness-execution";

export type ObservabilityEvidenceKind =
  | "structured-log"
  | "typed-event"
  | "run-artifact"
  | "explicit-error-result"
  | "focused-test-assertion"
  | "run-artifact-rationale";

export type ObservabilitySensitivityReason = {
  kind: ObservabilitySensitivityReasonKind;
  message: string;
};

export type ObservabilityEvidence = {
  kind: ObservabilityEvidenceKind;
  detail: string;
  ref: string;
};

export type ObservabilityObligationCandidate = {
  file: string;
  status: "satisfied" | "missing";
  reasons: ObservabilitySensitivityReason[];
  evidence: ObservabilityEvidence[];
  message: string;
};

export type ObservabilityFollowUpTaskSeed = {
  title: string;
  summary: string;
  candidateFiles: string[];
  artifact: typeof OBSERVABILITY_OBLIGATION_REVIEW_ARTIFACT;
};

export type ObservabilityObligationReview = {
  type: typeof OBSERVABILITY_OBLIGATION_WARNING_TYPE;
  outcome: "ok" | "warning";
  candidates: ObservabilityObligationCandidate[];
  satisfiedFiles: string[];
  missingFiles: string[];
  message: string;
  followUpTask?: ObservabilityFollowUpTaskSeed;
};
