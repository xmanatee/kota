import type {
  OwnerInterventionOutcomeBucket,
  OwnerInterventionRecord,
} from "./report/owner-intervention-types.js";

export const DEFAULT_OWNER_INTERVENTION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_OWNER_INTERVENTION_MIN_QUESTIONS = 2;
export const DEFAULT_OWNER_INTERVENTION_MIN_DISTINCT_RUNS = 2;
export const DEFAULT_OWNER_INTERVENTION_REPORT_LIMIT = 5;
export const OWNER_INTERVENTION_TASK_ID_PREFIX =
  "task-repair-owner-intervention-pattern-";
export const OWNER_INTERVENTION_EVIDENCE_FINGERPRINT_RE =
  /<!-- owner-intervention-evidence-fingerprint: ([a-f0-9]+) -->/;

export type OwnerInterventionPatternKind =
  | "repeated-freeform-correction"
  | "repeated-stale-or-expired";

export type OwnerInterventionPatternActionability =
  | "code-actionable"
  | "ignored";

export type OwnerInterventionPatternDimensionKind =
  | "task"
  | "task-family"
  | "workflow"
  | "source";

export type OwnerInterventionPatternDimension = {
  kind: OwnerInterventionPatternDimensionKind;
  value: string;
};

export type OwnerInterventionEvidenceRef = {
  questionId: string;
  status: OwnerInterventionRecord["status"];
  outcomeBucket: OwnerInterventionOutcomeBucket;
  createdAt: string;
  resolvedAt: string | null;
  source: string;
  workflowName: string | null;
  runId: string | null;
  taskId: string | null;
  refs: OwnerInterventionRecord["refs"];
  markers: OwnerInterventionRecord["markers"];
};

export type OwnerInterventionPattern = {
  kind: OwnerInterventionPatternKind;
  actionability: OwnerInterventionPatternActionability;
  fingerprint: string;
  evidenceFingerprint: string;
  taskId: string;
  dimension: OwnerInterventionPatternDimension;
  questionCount: number;
  distinctRunCount: number;
  outcomeBuckets: OwnerInterventionOutcomeBucket[];
  statuses: OwnerInterventionRecord["status"][];
  workflowNames: string[];
  sources: string[];
  taskIds: string[];
  runIds: string[];
  questionIds: string[];
  windowStart: string;
  windowEnd: string;
  evidence: OwnerInterventionEvidenceRef[];
  codeActionableReason: string | null;
  ignoredReason: string | null;
  belowThresholdReason: string | null;
};

export type OwnerInterventionEscalationThresholds = {
  minQuestions: number;
  minDistinctRuns: number;
};

export type OwnerInterventionEscalationConfig = {
  nowMs?: number;
  windowMs?: number;
  minQuestions?: number;
  minDistinctRuns?: number;
};

export type OwnerInterventionEscalationDetection = {
  thresholds: OwnerInterventionEscalationThresholds;
  patterns: OwnerInterventionPattern[];
  ignoredPatterns: OwnerInterventionPattern[];
  belowThresholdPatterns: OwnerInterventionPattern[];
};

export type ExistingOwnerInterventionTask = {
  state: "backlog" | "ready" | "doing" | "blocked" | "done" | "dropped";
  path: string;
  content: string;
  evidenceFingerprint: string | null;
  createdAt: string | null;
};

export type OwnerInterventionEscalationProposal =
  | {
      action: "noop";
      pattern: OwnerInterventionPattern;
      reason: string;
      existingState?: ExistingOwnerInterventionTask["state"];
    }
  | {
      action: "create";
      pattern: OwnerInterventionPattern;
      target: "ready";
    }
  | {
      action: "refresh";
      pattern: OwnerInterventionPattern;
      target: "ready";
      previousEvidenceFingerprint: string | null;
    }
  | {
      action: "promote";
      pattern: OwnerInterventionPattern;
      fromState: "backlog";
      target: "ready";
      previousEvidenceFingerprint: string | null;
    }
  | {
      action: "recreate";
      pattern: OwnerInterventionPattern;
      previousState: "done" | "dropped";
      target: "ready";
      previousEvidenceFingerprint: string | null;
    };

export type OwnerInterventionEscalationApplied =
  | {
      kind: "noop";
      taskId: string;
      patternFingerprint: string;
      reason: string;
      existingState?: ExistingOwnerInterventionTask["state"];
    }
  | {
      kind: "created";
      taskId: string;
      patternFingerprint: string;
      path: string;
    }
  | {
      kind: "refreshed";
      taskId: string;
      patternFingerprint: string;
      path: string;
    }
  | {
      kind: "promoted";
      taskId: string;
      patternFingerprint: string;
      fromState: "backlog";
      path: string;
      previousPath: string;
    }
  | {
      kind: "recreated";
      taskId: string;
      patternFingerprint: string;
      previousState: "done" | "dropped";
      path: string;
    };

export type OwnerInterventionEscalationContext = {
  projectDir: string;
  nowIso: string;
};

export type OwnerInterventionPatternSummary = {
  kind: OwnerInterventionPatternKind;
  dimension: OwnerInterventionPatternDimension;
  questionCount: number;
  distinctRunCount: number;
  outcomeBuckets: OwnerInterventionOutcomeBucket[];
  repairTaskId: string;
  patternFingerprint: string;
  action: OwnerInterventionEscalationProposal["action"] | "below-threshold" | "ignored";
  reason: string;
  questionIds: string[];
  runIds: string[];
};

export type OwnerInterventionEscalationReport = {
  activePatterns: OwnerInterventionPatternSummary[];
  ignoredPatterns: OwnerInterventionPatternSummary[];
  belowThresholdPatterns: OwnerInterventionPatternSummary[];
};

export type OwnerInterventionAttentionEntry = {
  kind: OwnerInterventionPatternKind;
  dimension: OwnerInterventionPatternDimension;
  taskId: string;
  action: OwnerInterventionEscalationApplied["kind"] | "skipped";
  questionCount: number;
  runIds: string[];
};

export function normalizeOwnerInterventionEscalationConfig(
  config?: OwnerInterventionEscalationConfig,
): Required<OwnerInterventionEscalationConfig> {
  return {
    nowMs: config?.nowMs ?? Date.now(),
    windowMs: config?.windowMs ?? DEFAULT_OWNER_INTERVENTION_WINDOW_MS,
    minQuestions:
      config?.minQuestions ?? DEFAULT_OWNER_INTERVENTION_MIN_QUESTIONS,
    minDistinctRuns:
      config?.minDistinctRuns ??
      DEFAULT_OWNER_INTERVENTION_MIN_DISTINCT_RUNS,
  };
}

export function ownerInterventionThresholds(
  config: Required<OwnerInterventionEscalationConfig>,
): OwnerInterventionEscalationThresholds {
  return {
    minQuestions: config.minQuestions,
    minDistinctRuns: config.minDistinctRuns,
  };
}
