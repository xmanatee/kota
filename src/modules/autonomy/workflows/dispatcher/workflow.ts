import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import {
  getClaimAwareRepoTaskQueueSnapshot,
  isThinClaimAwareDispatchableQueue,
} from "#modules/autonomy/queue-availability.js";
import {
  BUILDER_RECOVERY_EVENT,
  requestPendingBuilderRecoveries,
} from "../builder/recovery-continuation.js";
import { inspectResearchRetryAvailability } from "../research-retry/precondition.js";
import { scopeImprovementEvidenceReady } from "../scope-improver/events.js";
import {
  inspectScopeImprovementEvidenceGate,
  recordScopeImprovementEvidenceReady,
} from "../scope-improver/evidence-gate.js";
import {
  inspectSecurityReviewDue,
  SECURITY_REVIEW_DUE_EVENT,
} from "../security-review/due-check.js";

// Not recovery-capable: dispatcher only reads repo state and emits events — it
// never mutates tracked files, so it cannot leave dirt to heal and cannot help
// clean dirt left by others. Recovery dispatch is handled by the worktree-
// mutating workflows (builder, inbox-sorter, decomposer, explorer, improver).
const dispatcherWorkflow: WorkflowDefinitionInput = {
  name: "dispatcher",
  description:
    "Assess repo state on idle and emit condition-based events for other autonomy workflows.",
  triggers: [
    {
      event: "runtime.idle",
      cooldownMs: 30_000,
    },
  ],
  steps: [
    {
      id: "assess-and-dispatch",
      type: "code",
      run: ({ projectDir, emit }) => {
        const queue = getClaimAwareRepoTaskQueueSnapshot(projectDir);
        const researchRetryAvailability = inspectResearchRetryAvailability(projectDir);
        const securityReviewDue = inspectSecurityReviewDue(projectDir);
        const scopeImprovementEvidence = inspectScopeImprovementEvidenceGate({
          projectDir,
          now: new Date(),
        });
        const builderRecovery = requestPendingBuilderRecoveries({ projectDir, emit });
        const queueBlocked =
          !queue.hasDispatchableWork &&
          (queue.dependencyBlockedTasks.length > 0 ||
            queue.claimBlockedTasks.length > 0);
        const queueEmpty = !queue.hasDispatchableWork && !queueBlocked;
        // Builder runs only on actionable (ready+doing) work; backlog-only queues
        // route through `autonomy.queue.needs-promotion` only when the canonical
        // task snapshot says at least one backlog task can actually be promoted.
        // Strategic anchors, blocked tails, and Meta tasks missing a
        // Product/Safety link are open records, not dispatchable work.
        const queueActionable = queue.actionableCount > 0;
        const queueNeedsPromotion =
          queue.actionableCount === 0 && queue.promotableBacklogCount > 0;
        const blockedResearchAttemptable =
          researchRetryAvailability.attemptableCount > 0;
        const queueThin = isThinClaimAwareDispatchableQueue(queue);

        if (queue.inboxCount > 0) {
          emit("autonomy.inbox.available", { inboxCount: queue.inboxCount });
        }
        if (queueActionable) {
          emit("autonomy.queue.available", {
            pullableCount: queue.pullableCount,
            actionableCount: queue.actionableCount,
            dispatchableCount: queue.dispatchableCount,
            counts: queue.counts,
            dependencyBlockedTasks: queue.dependencyBlockedTasks,
            claimBlockedTasks: queue.claimBlockedTasks,
          });
        }
        if (queueNeedsPromotion) {
          emit("autonomy.queue.needs-promotion", {
            backlogCount: queue.counts.backlog,
            promotableBacklogCount: queue.promotableBacklogCount,
            dispatchableCount: queue.dispatchableCount,
            counts: queue.counts,
            dependencyBlockedTasks: queue.dependencyBlockedTasks,
            claimBlockedTasks: queue.claimBlockedTasks,
          });
        }
        if (queueEmpty) {
          emit("autonomy.queue.empty", {
            counts: queue.counts,
            dependencyBlockedTasks: queue.dependencyBlockedTasks,
            claimBlockedTasks: queue.claimBlockedTasks,
          });
        }
        if (blockedResearchAttemptable) {
          emit("autonomy.blocked-research.attemptable", {
            candidateCount: researchRetryAvailability.candidateCount,
            attemptableCount: researchRetryAvailability.attemptableCount,
            counts: queue.counts,
          });
        }
        if (securityReviewDue.due) {
          emit(SECURITY_REVIEW_DUE_EVENT, securityReviewDue);
        }
        if (
          scopeImprovementEvidence.shouldEmit &&
          scopeImprovementEvidence.payload
        ) {
          recordScopeImprovementEvidenceReady({
            projectDir,
            payload: scopeImprovementEvidence.payload,
          });
          emit(
            scopeImprovementEvidenceReady.name,
            scopeImprovementEvidence.payload,
          );
        }
        if (queueThin) {
          emit("autonomy.queue.thin", {
            pullableCount: queue.pullableCount,
            promotableBacklogCount: queue.promotableBacklogCount,
            dispatchableCount: queue.dispatchableCount,
            dependencyBlockedTasks: queue.dependencyBlockedTasks,
            claimBlockedTasks: queue.claimBlockedTasks,
            counts: queue.counts,
          });
        }
        const emitted = [
          queue.inboxCount > 0 && "autonomy.inbox.available",
          queueActionable && "autonomy.queue.available",
          queueNeedsPromotion && "autonomy.queue.needs-promotion",
          queueEmpty && "autonomy.queue.empty",
          blockedResearchAttemptable && "autonomy.blocked-research.attemptable",
          securityReviewDue.due && SECURITY_REVIEW_DUE_EVENT,
          scopeImprovementEvidence.shouldEmit &&
            scopeImprovementEvidenceReady.name,
          builderRecovery.requested.length > 0 && BUILDER_RECOVERY_EVENT,
          queueThin && "autonomy.queue.thin",
        ].filter((event): event is string => Boolean(event));
        const quiescent = emitted.length === 0;

        return {
          inboxCount: queue.inboxCount,
          pullableCount: queue.pullableCount,
          actionableCount: queue.actionableCount,
          dispatchableCount: queue.dispatchableCount,
          dependencyBlockedTasks: queue.dependencyBlockedTasks,
          claimBlockedTasks: queue.claimBlockedTasks,
          promotableBacklogCount: queue.promotableBacklogCount,
          researchRetryCandidateCount: researchRetryAvailability.candidateCount,
          researchRetryAttemptableCount: researchRetryAvailability.attemptableCount,
          builderRecoveryCandidateCount: builderRecovery.candidateCount,
          builderRecoveryRequested: builderRecovery.requested,
          securityReviewDue,
          scopeImprovementEvidence: {
            shouldEmit: scopeImprovementEvidence.shouldEmit,
            reason: scopeImprovementEvidence.reason,
            dedupeSignature:
              scopeImprovementEvidence.payload?.dedupeSignature ?? null,
            totalWeight: scopeImprovementEvidence.payload?.totalWeight ?? 0,
            evidenceIds: scopeImprovementEvidence.payload?.evidenceIds ?? [],
          },
          emitted,
          quiescent,
          quiescentReason: quiescent
            ? queueBlocked
              ? "work is dependency- or claim-blocked"
              : "no autonomy routing condition matched"
            : null,
        };
      },
    },
  ],
};

export default dispatcherWorkflow;
