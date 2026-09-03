import type { ModuleSetupRequirementStatus } from "#core/modules/setup-requirements.js";
import type { AutonomyMode } from "#core/tools/autonomy-mode.js";
import type {
  ResolvedScopePolicy,
  ScopePolicyFragment,
  ScopeWriteBoundary,
} from "./scope-policy.js";
import type { ScopeId } from "./scope-registry.js";

export type ScopeOnboardingDirectoryKind = "git-repository" | "directory";

export type ScopeImprovementPosture = "observe" | "propose" | "build";

export type ScopeOnboardingReason = {
  code: string;
  message: string;
  capability?: string;
};

export type ScopeOnboardingInspection = {
  inspectionId: string;
  operationId: string;
  scopeId: ScopeId;
  directoryRoot: string;
  displayName: string;
  kind: ScopeOnboardingDirectoryKind;
  registered: boolean;
  hostingState: "inactive" | "hosted" | "draining" | "drained" | null;
  trust: { trusted: boolean; source: string } | null;
  policyRevision: number;
  policyFragment: ScopePolicyFragment | null;
  policy: ResolvedScopePolicy | null;
  existing: {
    kotaState: boolean;
    scopeConfig: boolean;
    taskQueue: boolean;
    inbox: boolean;
    guidance: readonly string[];
  };
  setup: readonly ModuleSetupRequirementStatus[];
  blockers: readonly ScopeOnboardingReason[];
};

export type ScopeOnboardingChoices = {
  displayName?: string;
  trust?: boolean;
  improvementPosture?: ScopeImprovementPosture;
  writes?: ScopeWriteBoundary;
};

export type ScopeOnboardingNormalizedChoices = {
  displayName: string;
  trust: boolean;
  improvementPosture: ScopeImprovementPosture;
  writes: ScopeWriteBoundary;
};

export type ScopeOnboardingRuntimeDirectory =
  | ".kota"
  | ".kota/runs"
  | ".kota/approvals"
  | ".kota/dead-letter-queue"
  | ".kota/idempotency"
  | ".kota/owner-decisions"
  | ".kota/owner-questions";

export type ScopeOnboardingChange =
  | { owner: "machine"; kind: "register-scope"; scopeId: ScopeId }
  | {
      owner: "machine";
      kind: "update-display-name";
      scopeId: ScopeId;
      displayName: string;
    }
  | {
      owner: "machine";
      kind: "set-authority";
      scopeId: ScopeId;
      trust: boolean;
      improvementPosture: ScopeImprovementPosture;
      writes: ScopeWriteBoundary;
    }
  | {
      owner: "scope";
      kind: "create-runtime-directory";
      path: ScopeOnboardingRuntimeDirectory;
    };

export type ScopeOnboardingPlan = {
  schema: 2;
  planId: string;
  operationId: string;
  inspectionId: string;
  scopeId: ScopeId;
  directoryRoot: string;
  createdAt: string;
  choices: ScopeOnboardingNormalizedChoices;
  registrationBaseline: {
    registered: boolean;
    displayName: string;
    hostingState: ScopeOnboardingInspection["hostingState"];
  };
  authorityBaseline: {
    revision: number;
    trusted: boolean;
    policyFragment: ScopePolicyFragment | null;
  };
  changes: readonly ScopeOnboardingChange[];
  permissions: {
    trusted: boolean;
    autonomy: AutonomyMode;
    writes: ScopeWriteBoundary;
    improvement: {
      posture: ScopeImprovementPosture;
      review: "disabled" | "owner-questions" | "task-proposals";
      builder: "disabled" | "enabled";
    };
  };
  blockers: readonly ScopeOnboardingReason[];
};

export type ScopeOnboardingPlanResult =
  | { ok: true; plan: ScopeOnboardingPlan }
  | { ok: false; reason: "invalid_directory" | "invalid_choices"; message: string };

/** Minimal wire receipt used to accept a server-produced canonical plan. */
export type ScopeOnboardingAcceptedPlan = Pick<
  ScopeOnboardingPlan,
  | "planId"
  | "operationId"
  | "inspectionId"
  | "directoryRoot"
  | "createdAt"
  | "choices"
>;

export type ScopeOnboardingReadiness = {
  scopeId: ScopeId;
  directoryRoot: string;
  registered: boolean;
  configured: boolean;
  trusted: boolean;
  workflowReady: boolean;
  blocked: boolean;
  partiallyApplied: boolean;
  improvement: {
    posture: ScopeImprovementPosture;
    review: "disabled" | "owner-questions" | "task-proposals";
    builder: "disabled" | "enabled";
    autonomyMode: AutonomyMode;
    writes: ScopeWriteBoundary;
  };
  reasons: readonly ScopeOnboardingReason[];
};

export type ScopeOnboardingMutation = {
  kind:
    | ScopeOnboardingChange["kind"]
    | "activate-scope"
    | "complete-onboarding"
    | "rollback-authority"
    | "rollback";
  target: string;
  status: "prepared" | "applied" | "unchanged" | "rolled-back" | "failed";
  at: string;
  message?: string;
};

export type ScopeOnboardingOperationState =
  | "planned"
  | "applying"
  | "succeeded"
  | "incomplete"
  | "cancelled";

export type ScopeOnboardingOperation = {
  schema: 2;
  operationId: string;
  state: ScopeOnboardingOperationState;
  acceptedPlan: ScopeOnboardingPlan;
  attempts: number;
  registeredByOperation: boolean;
  authorityRevision: number;
  authorityApplied: { revision: number; auditId: string } | null;
  displayNameBefore: string | null;
  mutations: readonly ScopeOnboardingMutation[];
  readiness: ScopeOnboardingReadiness;
  provenance: {
    actor: "operator";
    acceptedAt: string;
    lastUpdatedAt: string;
  };
  error: ScopeOnboardingReason | null;
};

export type ScopeOnboardingApplyResult =
  | { ok: true; operation: ScopeOnboardingOperation }
  | {
      ok: false;
      reason:
        | "blocked"
        | "plan_changed"
        | "operator_action_required"
        | "apply_failed"
        | "rollback_failed"
        | "not_found"
        | "not_cancellable";
      message: string;
      operation?: ScopeOnboardingOperation;
    };
