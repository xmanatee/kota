import { join } from "node:path";

export const SCOPE_IMPROVEMENT_ARTIFACT = "scope-improvement.json";
export const SCOPE_IMPROVEMENT_SCHEDULE_EVENT =
  "autonomy.scope-improvement.scheduled";
export const SCOPE_IMPROVEMENT_STATE_PATH = join(
  ".kota",
  "scope-improvement",
  "state.json",
);
export const SCOPE_IMPROVEMENT_CONFIG_PATH = join(
  ".kota",
  "scope-improvement",
  "config.json",
);
export const SCOPE_IMPROVEMENT_DEFAULT_MIN_MINUTES_BETWEEN_RUNS = 30;
export const SCOPE_IMPROVEMENT_DEFAULT_MAX_ACTIONS_PER_RUN = 2;
export const SCOPE_IMPROVEMENT_MAX_CHANGED_FILES_PER_RUN = 30;
export const SCOPE_IMPROVEMENT_MAX_SIGNATURES = 80;

export type ScopeImprovementTriggerKind =
  | "manual"
  | "schedule"
  | "file"
  | "task"
  | "run";

export type ScopeImprovementConfig = {
  enabled: boolean;
  minMinutesBetweenRuns: number;
  maxActionsPerRun: number;
  allowAutonomousEdits: boolean;
  writePaths: string[];
};

export type ScopeImprovementState = {
  scopeId: string;
  lastRunAt: string | null;
  recentSignatures: { signature: string; action: string; lastSeenAt: string }[];
};

export type ScopeInstruction = {
  path: string;
  excerpt: string;
};

export type ScopeImprovementEvidence = {
  id: string;
  kind: "instruction" | "file" | "task" | "run" | "queue" | "policy";
  summary: string;
  path?: string;
};

export type ScopeImprovementInputs = {
  generatedAt: string;
  triggerKind: ScopeImprovementTriggerKind;
  triggerEvent: string;
  scope: {
    scopeId: string;
    displayName: string;
    directoryRoot: string;
  };
  config: ScopeImprovementConfig;
  state: ScopeImprovementState;
  instructions: ScopeInstruction[];
  changedFiles: string[];
  evidence: ScopeImprovementEvidence[];
  throttle: { reason: string; eventCount: number } | null;
};

export type ScopeImprovementCandidate = {
  id: string;
  signature: string;
  title: string;
  summary: string;
  evidenceIds: string[];
  preferredAction: "create-task" | "owner-question" | "safe-edit";
};

export type ScopeImprovementEvidencePacket = {
  generatedAt: string;
  scope: ScopeImprovementInputs["scope"];
  triggerKind: ScopeImprovementTriggerKind;
  triggerEvent: string;
  evidence: ScopeImprovementEvidence[];
  candidates: ScopeImprovementCandidate[];
};

export type ScopeImprovementRecommendation =
  | {
      kind: "create-task";
      signature: string;
      title: string;
      summary: string;
      evidenceIds: string[];
    }
  | {
      kind: "owner-question";
      signature: string;
      question: string;
      reason: string;
      evidenceIds: string[];
      proposedAnswers: string[];
    }
  | {
      kind: "safe-edit";
      signature: string;
      path: string;
      title: string;
      summary: string;
      evidenceIds: string[];
    }
  | {
      kind: "skipped";
      signature: string;
      reason: string;
      evidenceIds: string[];
    };

export type ScopeImprovementAppliedAction =
  | { kind: "created-task"; taskId: string; path: string; signature: string }
  | { kind: "owner-question"; questionId: string; signature: string }
  | { kind: "safe-edit"; path: string; signature: string }
  | { kind: "skipped"; signature: string; reason: string };

export type ScopeImprovementActionResult = {
  createdTaskIds: string[];
  ownerQuestionIds: string[];
  safeEditPaths: string[];
  applied: ScopeImprovementAppliedAction[];
  requiresCommit: boolean;
};

export type ScopeImprovementArtifact = {
  generatedAt: string;
  inputs: ScopeImprovementInputs;
  evidence: ScopeImprovementEvidencePacket;
  recommendations: ScopeImprovementRecommendation[];
  actions: ScopeImprovementActionResult;
};
