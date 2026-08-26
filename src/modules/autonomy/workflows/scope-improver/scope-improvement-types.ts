import { join } from "node:path";
import type { RepoTaskState } from "#modules/repo-tasks/repo-tasks-domain.js";

export const SCOPE_IMPROVEMENT_ARTIFACT = "scope-improvement.json";
export const SCOPE_IMPROVEMENT_CONFIG_PATH = join(
  ".kota",
  "scope-improvement",
  "config.json",
);
export const SCOPE_IMPROVEMENT_CONFIG_FILE = join(
  "scope-improvement",
  "config.json",
);
export const SCOPE_IMPROVEMENT_DEFAULT_MAX_ACTIONS_PER_RUN = 2;
export const SCOPE_IMPROVEMENT_MAX_CHANGED_FILES_PER_RUN = 30;
export const SCOPE_IMPROVEMENT_MAX_SIGNATURES = 80;

export type ScopeImprovementTriggerKind =
  | "explicit-request"
  | "initial-onboarding"
  | "content-policy-changed";

export type ScopeImprovementConfig = {
  enabled: boolean;
  maxActionsPerRun: number;
};

export type ScopeImprovementState = {
  scopeId: string;
  lastRunAt: string | null;
  consumedFingerprint: string | null;
  pendingFingerprint: string | null;
  pendingBoundary: "initial-onboarding" | "content-policy-changed" | null;
  pendingDelivery: "queued" | "deferred" | null;
  pendingDeliveryAttempt: number;
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
  semanticInput: {
    automatic: boolean;
    fingerprint: string;
    evidenceRefs: string[];
  };
  alreadyConsumed: boolean;
};

export type ScopeImprovementTaskSpec = {
  problem: string;
  desiredOutcome: string;
  constraints: string[];
  howWeWillKnow: string[];
};

type ScopeImprovementCandidateBase = {
  id: string;
  signature: string;
  title: string;
  summary: string;
  evidenceIds: string[];
};

export type ScopeImprovementCandidate =
  | (ScopeImprovementCandidateBase & {
      preferredAction: "create-task";
      task: ScopeImprovementTaskSpec;
    })
  | (ScopeImprovementCandidateBase & {
      preferredAction: "owner-question";
    })
  | (ScopeImprovementCandidateBase & {
      preferredAction: "skip";
      skipReason: string;
    });

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
      task: ScopeImprovementTaskSpec;
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
      kind: "skipped";
      signature: string;
      reason: string;
      evidenceIds: string[];
    };

export type ScopeImprovementAppliedAction =
  | { kind: "created-task"; taskId: string; path: string; signature: string }
  | { kind: "updated-task"; taskId: string; path: string; signature: string }
  | {
      kind: "dropped-task";
      taskId: string;
      fromState: RepoTaskState;
      signature: string;
    }
  | { kind: "owner-question-pending"; signature: string }
  | { kind: "owner-question"; questionId: string; signature: string }
  | { kind: "updated-owner-question"; questionId: string; signature: string }
  | { kind: "skipped"; signature: string; reason: string };

export type ScopeImprovementActionResult = {
  createdTaskIds: string[];
  ownerQuestionIds: string[];
  applied: ScopeImprovementAppliedAction[];
  requiresCommit: boolean;
};

export type ScopeImprovementPreflight = {
  worktree: {
    available: boolean;
    dirty: boolean;
    entries: string[];
    summary: string;
  };
};

export type ScopeImprovementConsumptionDecision = {
  disposition: "consume" | "defer" | "ignore";
  reason: string | null;
};

export type ScopeImprovementArtifact = {
  schemaVersion: 1;
  generatedAt: string;
  preflight: ScopeImprovementPreflight;
  inputs: ScopeImprovementInputs;
  evidence: ScopeImprovementEvidencePacket;
  recommendations: ScopeImprovementRecommendation[];
  actions: ScopeImprovementActionResult;
  consumption: ScopeImprovementConsumptionDecision;
};
