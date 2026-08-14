import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  type ClaimAwareRepoTaskQueueSnapshot,
  getClaimAwareRepoTaskQueueSnapshot,
} from "#modules/autonomy/queue-availability.js";
import {
  type BuilderRecoveryDispatchResult,
  inspectPendingBuilderRecoveriesInWorker,
} from "../builder/recovery-continuation.js";
import {
  inspectResearchRetryAvailability,
  type ResearchRetryAvailability,
} from "../research-retry/precondition.js";
import {
  inspectScopeImprovementEvidenceGate,
  recordScopeImprovementEvidenceReady,
  type ScopeImprovementEvidenceGateResult,
} from "../scope-improver/evidence-gate.js";
import {
  inspectSecurityReviewDue,
  type SecurityReviewDueDecision,
} from "../security-review/due-check.js";

export type DispatcherInspection = {
  queue: ClaimAwareRepoTaskQueueSnapshot;
  researchRetryAvailability: ResearchRetryAvailability;
  securityReviewDue: SecurityReviewDueDecision;
  scopeImprovementEvidence: ScopeImprovementEvidenceGateResult;
  builderRecovery: BuilderRecoveryDispatchResult;
};

export function inspectDispatcherStateInWorker(input: {
  projectDir: string;
  nowIso: string;
}): DispatcherInspection {
  const now = new Date(input.nowIso);
  const queue = getClaimAwareRepoTaskQueueSnapshot(input.projectDir, now);
  const researchRetryAvailability = inspectResearchRetryAvailability(
    input.projectDir,
  );
  const securityReviewDue = inspectSecurityReviewDue(input.projectDir, { now });
  const scopeImprovementEvidence = inspectScopeImprovementEvidenceGate({
    projectDir: input.projectDir,
    now,
  });
  if (
    scopeImprovementEvidence.shouldEmit &&
    scopeImprovementEvidence.payload !== null
  ) {
    recordScopeImprovementEvidenceReady({
      projectDir: input.projectDir,
      payload: scopeImprovementEvidence.payload,
    });
  }
  const builderRecovery = inspectPendingBuilderRecoveriesInWorker({
    projectDir: input.projectDir,
  });
  return {
    queue,
    researchRetryAvailability,
    securityReviewDue,
    scopeImprovementEvidence,
    builderRecovery,
  };
}

export const dispatcherInspectionOperation = defineWorkflowBlockingOperation<
  { projectDir: string; nowIso: string },
  DispatcherInspection
>(import.meta.url, "inspectDispatcherStateInWorker");
