import type { AgentUsage } from "#core/agent-harness/usage.js";

export const SHADOW_SEMANTIC_REVIEW_SCHEMA_VERSION = 2;
export const SHADOW_SEMANTIC_REVIEW_ARTIFACT_TYPE = "shadow-semantic-review";
export const SHADOW_SEMANTIC_REVIEW_DIR = "shadow-review";

export type ShadowSemanticReviewMode = "shadow" | "advisory";
export type ShadowSemanticReviewTargetKind =
  | "task-queue"
  | "source-decision"
  | "security"
  | "pr-support";
export type ShadowSemanticReviewStatus =
  | "reviewed"
  | "skipped"
  | "malformed"
  | "error";
export type ShadowSemanticReviewDecision =
  | "pass"
  | "warn"
  | "fail"
  | "skip"
  | "error";
export type ShadowSemanticReviewFindingSeverity =
  | "info"
  | "warning"
  | "critical";

export type ShadowSemanticReviewFinding = {
  severity: ShadowSemanticReviewFindingSeverity;
  summary: string;
  citedArtifacts: string[];
  falsePositive: boolean;
  falsePositiveReason?: string;
};

export type ShadowSemanticReviewArtifactRef = {
  path: string;
  content: string;
};

export type ShadowSemanticReviewTarget = {
  id: string;
  kind: ShadowSemanticReviewTargetKind;
  summary: string;
  artifacts: ShadowSemanticReviewArtifactRef[];
};

export type ShadowSemanticReviewTargetResolution =
  | { kind: "target"; target: ShadowSemanticReviewTarget }
  | { kind: "skip"; reason: string; citedArtifacts?: string[] };

export type ShadowSemanticReviewerProfile = {
  id: string;
  systemPrompt: string;
  question: string;
  model?: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
};

export type ShadowSemanticReviewerDeclaration = {
  id: string;
  mode: ShadowSemanticReviewMode;
  targetKind: ShadowSemanticReviewTargetKind;
  reviewer: ShadowSemanticReviewerProfile;
  promotionCandidateRef: string;
};

export type ShadowSemanticReviewerResponse = {
  decision: "pass" | "warn" | "fail";
  summary: string;
  findings: ShadowSemanticReviewFinding[];
  citedArtifacts: string[];
};

export type ShadowSemanticReviewArtifact = {
  schemaVersion: typeof SHADOW_SEMANTIC_REVIEW_SCHEMA_VERSION;
  artifactType: typeof SHADOW_SEMANTIC_REVIEW_ARTIFACT_TYPE;
  runId: string;
  workflow: string;
  generatedAt: string;
  declarationId: string;
  reviewerProfileId: string;
  reviewerPromptHash: string;
  mode: ShadowSemanticReviewMode;
  targetKind: ShadowSemanticReviewTargetKind;
  promotionCandidateRef: string;
  status: ShadowSemanticReviewStatus;
  decision: ShadowSemanticReviewDecision;
  target?: {
    id: string;
    summary: string;
    artifactPaths: string[];
  };
  summary: string;
  citedArtifacts: string[];
  findings: ShadowSemanticReviewFinding[];
  skippedReason?: string;
  error?: string;
  usage: AgentUsage;
  durationMs: number | null;
};

export type ShadowSemanticReviewReportRecord = {
  runId: string;
  workflow: string;
  generatedAt: string;
  artifact: string;
  declarationId: string;
  reviewerProfileId: string;
  mode: ShadowSemanticReviewMode;
  targetKind: ShadowSemanticReviewTargetKind;
  status: ShadowSemanticReviewStatus;
  decision: ShadowSemanticReviewDecision;
  catchCount: number;
  falsePositiveCount: number;
  skippedReason?: string;
  usage: AgentUsage;
  durationMs: number | null;
  promotionCandidateRef: string;
};

export type ShadowSemanticReviewUnsupportedArtifact = {
  runId: string;
  workflow: string;
  artifact: string;
  reason: string;
};

export type ShadowSemanticReviewReport = {
  totalArtifacts: number;
  reviewed: number;
  catches: number;
  falsePositiveAnnotations: number;
  skippedTargetResolution: number;
  malformedArtifacts: number;
  errorArtifacts: number;
  measuredCostArtifacts: number;
  unavailableCostArtifacts: number;
  unknownCostArtifacts: number;
  totalCostUsd: number | null;
  averageDurationMs: number | null;
  byWorkflow: {
    workflow: string;
    artifacts: number;
    catches: number;
    falsePositiveAnnotations: number;
    skippedTargetResolution: number;
    malformedArtifacts: number;
    measuredCostArtifacts: number;
    unavailableCostArtifacts: number;
    unknownCostArtifacts: number;
    totalCostUsd: number | null;
  }[];
  records: ShadowSemanticReviewReportRecord[];
  unsupported: ShadowSemanticReviewUnsupportedArtifact[];
};
