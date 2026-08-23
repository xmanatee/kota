import { createHash } from "node:crypto";
import type {
  RepoTaskClass,
  RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import type {
  ReviewDecision,
  ReviewScrutinyMetric,
  ReviewScrutinyRecord,
  ReviewScrutinySignals,
  ReviewSurface,
} from "./review-scrutiny-types.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const DEFAULT_REVIEW_SCRUTINY_WINDOW_MS = 7 * MS_PER_DAY;
export const DEFAULT_REVIEW_SCRUTINY_MIN_APPROVALS = 8;
export const DEFAULT_REVIEW_SCRUTINY_MIN_THIN_ACCEPTANCES = 5;
export const DEFAULT_REVIEW_SCRUTINY_MIN_RATIO = 0.75;
export const DEFAULT_REVIEW_SCRUTINY_COOLDOWN_MS = 3 * MS_PER_DAY;
export const DEFAULT_REVIEW_SCRUTINY_REPORT_LIMIT = 5;

export const REVIEW_SCRUTINY_TASK_ID_PREFIX =
  "task-repair-review-scrutiny-pattern-";
export const REVIEW_SCRUTINY_EVIDENCE_FINGERPRINT_RE =
  /<!-- review-scrutiny-evidence-fingerprint: ([a-f0-9]+) -->/;

export type ReviewScrutinyEscalationThresholds = {
  windowMs: number;
  minApprovalLikeDecisions: number;
  minThinAcceptances: number;
  minThinAcceptanceRatio: number;
  cooldownMs: number;
};

export type ReviewScrutinyEscalationConfig = Partial<
  ReviewScrutinyEscalationThresholds
> & {
  nowMs?: number;
};

export type NormalizedReviewScrutinyEscalationConfig =
  ReviewScrutinyEscalationThresholds & { nowMs: number };

export type ReviewScrutinyEvidenceRef = {
  runId: string;
  workflow: string;
  surface: ReviewSurface;
  decision: ReviewDecision;
  artifactPath: string;
  reviewerPromptHash?: string;
  signals: ReviewScrutinySignals;
  absentMetrics: ReviewScrutinyMetric[];
  taskId?: string;
  pr?: { repo: string; number: number };
};

export type ReviewScrutinyPatternCandidate = {
  surface: ReviewSurface;
  workflow: string;
  taskArea: string;
  taskClass: RepoTaskClass;
  approvalLikeDecisions: number;
  thinAcceptances: number;
  thinAcceptanceRatio: number;
  absentMetricCount: number;
  fingerprint: string;
  evidenceFingerprint: string;
  taskId: string;
  runIds: string[];
  taskIds: string[];
  artifactPaths: string[];
  decisions: ReviewDecision[];
  windowStart: string;
  windowEnd: string;
  evidence: ReviewScrutinyEvidenceRef[];
  reason: string;
  belowThresholdReason: string | null;
};

export type ReviewScrutinyEscalationDetection = {
  thresholds: ReviewScrutinyEscalationThresholds;
  patterns: ReviewScrutinyPatternCandidate[];
  belowThreshold: ReviewScrutinyPatternCandidate[];
  unsupportedArtifacts: number;
};

export type ExistingReviewScrutinyTask = {
  state: RepoTaskState;
  path: string;
  content: string;
  evidenceFingerprint: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type ReviewScrutinyEscalationProposal =
  | {
      action: "noop";
      pattern: ReviewScrutinyPatternCandidate;
      reason: string;
      suppression: "already-current" | "cooldown" | "in-flight";
      existingState?: RepoTaskState;
    }
  | { action: "create"; pattern: ReviewScrutinyPatternCandidate; target: "ready" }
  | {
      action: "refresh";
      pattern: ReviewScrutinyPatternCandidate;
      target: "ready";
      previousEvidenceFingerprint: string | null;
    }
  | {
      action: "promote";
      pattern: ReviewScrutinyPatternCandidate;
      fromState: "backlog";
      target: "ready";
      previousEvidenceFingerprint: string | null;
    }
  | {
      action: "recreate";
      pattern: ReviewScrutinyPatternCandidate;
      previousState: "done" | "dropped";
      target: "ready";
      previousEvidenceFingerprint: string | null;
    };

export type ReviewScrutinyEscalationReport = {
  activePatterns: ReviewScrutinyPatternSummary[];
  cooldownPatterns: ReviewScrutinyPatternSummary[];
  belowThresholdPatterns: ReviewScrutinyPatternSummary[];
};

export type ReviewScrutinyPatternSummary = {
  surface: ReviewSurface;
  workflow: string;
  taskArea: string;
  taskClass: RepoTaskClass;
  approvalLikeDecisions: number;
  thinAcceptances: number;
  thinAcceptanceRatio: number;
  repairTaskId: string;
  patternFingerprint: string;
  action: ReviewScrutinyEscalationProposal["action"] | "below-threshold";
  reason: string;
  runIds: string[];
};

export function normalizeReviewScrutinyEscalationConfig(
  config: ReviewScrutinyEscalationConfig | undefined,
): NormalizedReviewScrutinyEscalationConfig {
  return {
    nowMs: config?.nowMs ?? Date.now(),
    windowMs: config?.windowMs ?? DEFAULT_REVIEW_SCRUTINY_WINDOW_MS,
    minApprovalLikeDecisions:
      config?.minApprovalLikeDecisions ?? DEFAULT_REVIEW_SCRUTINY_MIN_APPROVALS,
    minThinAcceptances:
      config?.minThinAcceptances ?? DEFAULT_REVIEW_SCRUTINY_MIN_THIN_ACCEPTANCES,
    minThinAcceptanceRatio:
      config?.minThinAcceptanceRatio ?? DEFAULT_REVIEW_SCRUTINY_MIN_RATIO,
    cooldownMs: config?.cooldownMs ?? DEFAULT_REVIEW_SCRUTINY_COOLDOWN_MS,
  };
}

export function escalationThresholds(
  config: NormalizedReviewScrutinyEscalationConfig,
): ReviewScrutinyEscalationThresholds {
  return {
    windowMs: config.windowMs,
    minApprovalLikeDecisions: config.minApprovalLikeDecisions,
    minThinAcceptances: config.minThinAcceptances,
    minThinAcceptanceRatio: config.minThinAcceptanceRatio,
    cooldownMs: config.cooldownMs,
  };
}

export function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function shortHash(value: string): string {
  return stableHash(value).slice(0, 12);
}

export type ReviewScrutinyRecordGroup = {
  key: string;
  records: ReviewScrutinyRecord[];
};
