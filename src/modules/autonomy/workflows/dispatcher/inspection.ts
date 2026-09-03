import type { ScopePolicySnapshot } from "#core/daemon/scope-policy.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  getRepoTaskQueueSnapshot,
  type RepoTaskQueueSnapshot,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  type BuilderTaskDispatchPayload,
  listBuilderTaskDispatches,
} from "../builder/task-contract.js";
import {
  inspectResearchRetryAvailability,
  type ResearchRetryAvailability,
} from "../research-retry/precondition.js";
import { resolveScopeImprovementAuthority } from "../scope-improver/scope-improvement-authority.js";
import type { ScopeImprovementState } from "../scope-improver/scope-improvement-types.js";
import {
  inspectSecurityReviewDue,
  type SecurityReviewDueDecision,
  type SecurityReviewGitEvidence,
} from "../security-review/due-check.js";
import {
  inspectScopeSemanticBoundary,
  type ScopeBoundaryInspection,
} from "./semantic-reflection.js";

export type DispatcherInspection = {
  queue: RepoTaskQueueSnapshot;
  builderTasks: BuilderTaskDispatchPayload[];
  researchRetryAvailability: ResearchRetryAvailability;
  securityReviewDue: SecurityReviewDueDecision;
  scopeBoundary: ScopeBoundaryInspection;
};

export type DispatcherInspectionInput = {
  workspaceRoot: string;
  scopeRoot: string;
  scopeId: string;
  stateDir: string;
  nowIso: string;
  scopePolicySnapshot: ScopePolicySnapshot | null;
  scopeImprovementState: ScopeImprovementState;
  securityReviewGitEvidence: SecurityReviewGitEvidence;
};

export function inspectDispatcherStateInWorker(
  input: DispatcherInspectionInput,
): DispatcherInspection {
  const now = new Date(input.nowIso);
  let builderEnabled = false;
  if (input.scopePolicySnapshot !== null) {
    try {
      builderEnabled = resolveScopeImprovementAuthority({
        scopeRoot: input.scopeRoot,
        stateDir: input.stateDir,
        policy: input.scopePolicySnapshot.policy,
      }).builder === "enabled";
    } catch {
      // Malformed scope-owned configuration is surfaced by scopeBoundary and
      // must fail closed for builder admission without stopping other routing.
    }
  }
  return {
    queue: getRepoTaskQueueSnapshot(input.workspaceRoot),
    builderTasks: builderEnabled ? listBuilderTaskDispatches(input.workspaceRoot) : [],
    researchRetryAvailability: inspectResearchRetryAvailability(input.workspaceRoot),
    securityReviewDue: inspectSecurityReviewDue(input.workspaceRoot, {
      now,
      stateDir: input.stateDir,
    }, input.securityReviewGitEvidence),
    scopeBoundary: input.scopePolicySnapshot
      ? inspectScopeSemanticBoundary({
          workspaceRoot: input.workspaceRoot,
          scopeRoot: input.scopeRoot,
          scopeId: input.scopeId,
          stateDir: input.stateDir,
          scopePolicySnapshot: input.scopePolicySnapshot,
          state: input.scopeImprovementState,
        })
      : {
          shouldEmit: false,
          reason: "authoritative resolved scope policy is unavailable",
          payload: null,
          nextState: null,
        },
  };
}

export const dispatcherInspectionOperation = defineWorkflowBlockingOperation<
  DispatcherInspectionInput,
  DispatcherInspection
>(import.meta.url, "inspectDispatcherStateInWorker");
