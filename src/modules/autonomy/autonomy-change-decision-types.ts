export const AUTONOMY_CHANGE_DECISION_ARTIFACT =
  "autonomy-change-decision.json";
export const AUTONOMY_CHANGE_DECISION_ARTIFACT_TYPE =
  "autonomy-change-decision";
export const AUTONOMY_CHANGE_DECISION_SCHEMA_VERSION = 1;
export const AUTONOMY_CHANGE_DECISION_CHECK_ID = "autonomy-change-decision";

export const AUTONOMY_CHANGE_CLASSES = [
  "workflow",
  "prompt",
  "harness",
  "model-routing",
  "reviewer",
  "critic-gate",
  "improver-gate",
  "repair-loop",
] as const;

export const AUTONOMY_ROLLOUT_MODES = [
  "fixture-only",
  "shadow",
  "advisory",
  "blocking",
  "canary",
  "promoted",
  "rolled-back",
] as const;

export const AUTONOMY_DECISIONS = [
  "promote",
  "hold",
  "rollback",
  "needs-more-data",
] as const;

export const AUTONOMY_METRIC_DIRECTIONS = [
  "improved",
  "regressed",
  "unchanged",
  "mixed",
  "unknown",
] as const;

export type AutonomyChangeClass = (typeof AUTONOMY_CHANGE_CLASSES)[number];
export type AutonomyRolloutMode = (typeof AUTONOMY_ROLLOUT_MODES)[number];
export type AutonomyDecision = (typeof AUTONOMY_DECISIONS)[number];
export type AutonomyMetricDirection =
  (typeof AUTONOMY_METRIC_DIRECTIONS)[number];

export type AutonomyDecisionMetric = {
  name: string;
  baseline: string;
  candidate: string;
  unit: string;
  direction: AutonomyMetricDirection;
  qualitySignal: boolean;
};

export type AutonomyChangeDecisionArtifact = {
  schemaVersion: typeof AUTONOMY_CHANGE_DECISION_SCHEMA_VERSION;
  artifactType: typeof AUTONOMY_CHANGE_DECISION_ARTIFACT_TYPE;
  runId: string;
  createdAt: string;
  taskIds: string[];
  affectedSurfaces: string[];
  changeClasses: AutonomyChangeClass[];
  hypothesis: string;
  sourceRefs: string[];
  baselineRefs: string[];
  candidateRefs: string[];
  metricsCompared: AutonomyDecisionMetric[];
  rolloutMode: AutonomyRolloutMode;
  decision: AutonomyDecision;
  rationale: string;
  ownerSafetyExceptions: string[];
  followUpTaskIds: string[];
};

export type AutonomyChangeDecisionReadResult =
  | { kind: "missing"; path: string }
  | { kind: "invalid"; path: string; reason: string }
  | { kind: "valid"; path: string; artifact: AutonomyChangeDecisionArtifact };

export type MaterialAutonomyChangeReason = {
  file: string;
  changeClasses: AutonomyChangeClass[];
};

export type MaterialAutonomyChangeRequirement = {
  required: boolean;
  changedFiles: string[];
  changeClasses: AutonomyChangeClass[];
  reasons: MaterialAutonomyChangeReason[];
};
