import type { ScopePolicySnapshot } from "#core/daemon/scope-policy.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  type ClaimAwareRepoTaskQueueSnapshot,
  getClaimAwareRepoTaskQueueSnapshot,
} from "#modules/autonomy/queue-availability.js";
import {
  buildPromotionRationale,
  type PromotionRationale,
} from "../backlog-promoter/promotion.js";
import {
  type BuilderRecoveryDispatchResult,
  inspectPendingBuilderRecoveriesInWorker,
} from "../builder/recovery-continuation.js";
import {
  inspectResearchRetryAvailability,
  type ResearchRetryAvailability,
} from "../research-retry/precondition.js";
import {
  inspectSecurityReviewDue,
  type SecurityReviewDueDecision,
} from "../security-review/due-check.js";
import {
  inspectProgressSemanticBoundary,
  inspectScopeSemanticBoundary,
  type ProgressBoundaryInspection,
  type ScopeBoundaryInspection,
} from "./semantic-reflection.js";

export type DispatcherInspection = {
  queue: ClaimAwareRepoTaskQueueSnapshot;
  promotionRationale: PromotionRationale;
  researchRetryAvailability: ResearchRetryAvailability;
  securityReviewDue: SecurityReviewDueDecision;
  progressBoundary: ProgressBoundaryInspection;
  scopeBoundary: ScopeBoundaryInspection;
  builderRecovery: BuilderRecoveryDispatchResult;
};

export function inspectDispatcherStateInWorker(input: {
  projectDir: string;
  nowIso: string;
  scopePolicySnapshot: ScopePolicySnapshot | null;
}): DispatcherInspection {
  const now = new Date(input.nowIso);
  return {
    queue: getClaimAwareRepoTaskQueueSnapshot(input.projectDir, now),
    promotionRationale: buildPromotionRationale(input.projectDir),
    researchRetryAvailability: inspectResearchRetryAvailability(input.projectDir),
    securityReviewDue: inspectSecurityReviewDue(input.projectDir, { now }),
    progressBoundary: inspectProgressSemanticBoundary({
      projectDir: input.projectDir,
    }),
    scopeBoundary: input.scopePolicySnapshot
      ? inspectScopeSemanticBoundary({
          projectDir: input.projectDir,
          scopePolicySnapshot: input.scopePolicySnapshot,
        })
      : {
          shouldEmit: false,
          reason: "authoritative resolved scope policy is unavailable",
          payload: null,
        },
    builderRecovery: inspectPendingBuilderRecoveriesInWorker({
      projectDir: input.projectDir,
    }),
  };
}

export const dispatcherInspectionOperation = defineWorkflowBlockingOperation<
  {
    projectDir: string;
    nowIso: string;
    scopePolicySnapshot: ScopePolicySnapshot | null;
  },
  DispatcherInspection
>(import.meta.url, "inspectDispatcherStateInWorker");
