import type { ScopePolicySnapshot } from "#core/daemon/scope-policy.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  getRepoTaskQueueSnapshot,
  type RepoTaskQueueSnapshot,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  buildPromotionRationale,
  type PromotionRationale,
} from "../backlog-promoter/promotion.js";
import {
  type BuilderTaskDispatchPayload,
  listBuilderTaskDispatches,
} from "../builder/task-contract.js";
import {
  inspectResearchRetryAvailability,
  type ResearchRetryAvailability,
} from "../research-retry/precondition.js";
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
  promotionRationale: PromotionRationale;
  researchRetryAvailability: ResearchRetryAvailability;
  securityReviewDue: SecurityReviewDueDecision;
  scopeBoundary: ScopeBoundaryInspection;
};

export type DispatcherInspectionInput = {
  projectDir: string;
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
  return {
    queue: getRepoTaskQueueSnapshot(input.projectDir),
    builderTasks: listBuilderTaskDispatches(input.projectDir),
    promotionRationale: buildPromotionRationale(input.projectDir),
    researchRetryAvailability: inspectResearchRetryAvailability(input.projectDir),
    securityReviewDue: inspectSecurityReviewDue(input.projectDir, {
      now,
      stateDir: input.stateDir,
    }, input.securityReviewGitEvidence),
    scopeBoundary: input.scopePolicySnapshot
      ? inspectScopeSemanticBoundary({
          projectDir: input.projectDir,
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
