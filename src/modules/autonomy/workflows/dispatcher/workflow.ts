import { isDeepStrictEqual } from "node:util";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { WorkflowDefinitionInput } from "#core/workflow/types.js";
import { automaticProgressReviewRequested } from "../progress-reviewer/events.js";
import {
  scopeImprovementChanged,
  scopeImprovementRequested,
} from "../scope-improver/events.js";
import {
  decodeScopeImprovementState,
  SCOPE_IMPROVEMENT_STATE_KEY,
} from "../scope-improver/scope-improvement-state.js";
import type { ScopeImprovementState } from "../scope-improver/scope-improvement-types.js";
import {
  collectSecurityReviewGitEvidence,
  SECURITY_REVIEW_DUE_EVENT,
} from "../security-review/due-check.js";
import { dispatcherInspectionOperation } from "./inspection.js";
import {
  inspectProgressSemanticBoundary,
  PROGRESS_BOUNDARY_STATE_KEY,
  type ProgressBoundaryState,
} from "./semantic-reflection.js";

const dispatcherWorkflow: WorkflowDefinitionInput = {
  name: "dispatcher",
  description:
    "Assess repo state on idle and emit condition-based events for other autonomy workflows.",
  repository: "read",
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
      run: async ({
        projectDir,
        scopeDir,
        stateDir,
        state,
        emit,
        runBlocking,
        runCommand,
        scopePolicySnapshot,
      }) => {
        const progressState = state.read<ProgressBoundaryState>(
          PROGRESS_BOUNDARY_STATE_KEY,
        );
        const scopeState = state.read<ScopeImprovementState>(
          SCOPE_IMPROVEMENT_STATE_KEY,
        );
        const scopeImprovementState = decodeScopeImprovementState(
          scopeState.value,
          deriveDirectoryScopeId(scopeDir),
        );
        const securityReviewGitEvidence = await collectSecurityReviewGitEvidence({
          projectDir,
          stateDir,
          runCommand,
        });
        const [inspection, progressBoundary] = await Promise.all([
          runBlocking(dispatcherInspectionOperation, {
            projectDir,
            stateDir,
            nowIso: new Date().toISOString(),
            scopePolicySnapshot: scopePolicySnapshot ?? null,
            scopeImprovementState,
            securityReviewGitEvidence,
          }),
          inspectProgressSemanticBoundary({
            projectDir,
            scopeDir,
            stateDir,
            progressBoundaryState: progressState.value,
            runCommand,
          }),
        ]);
        const {
          queue,
          promotionRationale,
          researchRetryAvailability,
          securityReviewDue,
          scopeBoundary,
          builderTasks,
        } = inspection;
        if (
          progressBoundary.nextState !== null &&
          !isDeepStrictEqual(progressBoundary.nextState, progressState.value)
        ) {
          state.compareAndSet(
            PROGRESS_BOUNDARY_STATE_KEY,
            progressState.revision,
            progressBoundary.nextState,
          );
        }
        const scopeBoundaryEvent = !scopeBoundary.shouldEmit || !scopeBoundary.payload
          ? null
          : scopeBoundary.payload.boundary === "initial-onboarding"
            ? scopeImprovementRequested.name
            : scopeImprovementChanged.name;
        const queueBlocked =
          !queue.hasDispatchableWork &&
          queue.dependencyBlockedTasks.length > 0;
        const queueEmpty = !queue.hasDispatchableWork && !queueBlocked;
        // Builders run only on ready/doing work. Backlog-only queues route
        // through promotion when at least one non-anchor, dependency-clear task
        // can enter ready under the canonical transition contract.
        const queueNeedsPromotion =
          promotionRationale.selected.length > 0;
        const queueActionable =
          !queueNeedsPromotion && builderTasks.length > 0;
        const blockedResearchAttemptable =
          researchRetryAvailability.attemptableCount > 0;
        const dispatchableTailCount =
          queue.actionableCount + queue.promotableBacklogCount;
        const queueThin =
          queue.inboxCount === 0 &&
          dispatchableTailCount > 0 &&
          dispatchableTailCount <= 2;

        if (queue.inboxCount > 0) {
          emit("autonomy.inbox.available", { inboxCount: queue.inboxCount });
        }
        if (queueActionable) {
          for (const task of builderTasks) emit("autonomy.queue.available", task);
        }
        if (queueNeedsPromotion) {
          emit("autonomy.queue.needs-promotion", {
            backlogCount: queue.counts.backlog,
            promotableBacklogCount: queue.promotableBacklogCount,
            dispatchableCount: queue.dispatchableCount,
            counts: queue.counts,
            dependencyBlockedTasks: queue.dependencyBlockedTasks,
          });
        }
        if (queueEmpty) {
          emit("autonomy.queue.empty", {
            counts: queue.counts,
            dependencyBlockedTasks: queue.dependencyBlockedTasks,
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
        if (progressBoundary.shouldEmit && progressBoundary.payload) {
          emit(automaticProgressReviewRequested.name, progressBoundary.payload, {
            delivery: "on-run-success",
            stepId: "assess-and-dispatch:progress-review",
          });
        }
        if (scopeBoundary.shouldEmit && scopeBoundary.payload) {
          if (scopeBoundary.nextState === null) {
            throw new Error("scope boundary emission requires a staged state transition");
          }
          state.compareAndSet(
            SCOPE_IMPROVEMENT_STATE_KEY,
            scopeState.revision,
            scopeBoundary.nextState,
          );
          emit(scopeBoundaryEvent!, scopeBoundary.payload, {
            delivery: "on-run-success",
            stepId: "assess-and-dispatch:scope-improvement",
          });
        }
        if (queueThin) {
          emit("autonomy.queue.thin", {
            pullableCount: queue.pullableCount,
            promotableBacklogCount: queue.promotableBacklogCount,
            dispatchableCount: queue.dispatchableCount,
            dependencyBlockedTasks: queue.dependencyBlockedTasks,
            counts: queue.counts,
          });
        }
        const emitted = [
          queue.inboxCount > 0 && "autonomy.inbox.available",
          ...builderTasks.map(() => queueActionable && "autonomy.queue.available"),
          queueNeedsPromotion && "autonomy.queue.needs-promotion",
          queueEmpty && "autonomy.queue.empty",
          blockedResearchAttemptable && "autonomy.blocked-research.attemptable",
          securityReviewDue.due && SECURITY_REVIEW_DUE_EVENT,
          progressBoundary.shouldEmit && automaticProgressReviewRequested.name,
          scopeBoundaryEvent,
          queueThin && "autonomy.queue.thin",
        ].filter((event): event is string => Boolean(event));
        const quiescent = emitted.length === 0;

        return {
          inboxCount: queue.inboxCount,
          pullableCount: queue.pullableCount,
          actionableCount: queue.actionableCount,
          dispatchableCount: queue.dispatchableCount,
          dependencyBlockedTasks: queue.dependencyBlockedTasks,
          builderTaskIds: builderTasks.map((task) => task.taskId),
          promotableBacklogCount: queue.promotableBacklogCount,
          promotionFrontier: promotionRationale.frontier,
          researchRetryCandidateCount: researchRetryAvailability.candidateCount,
          researchRetryAttemptableCount: researchRetryAvailability.attemptableCount,
          securityReviewDue,
          progressBoundary: {
            shouldEmit: progressBoundary.shouldEmit,
            reason: progressBoundary.reason,
            boundary: progressBoundary.payload?.boundary ?? null,
            inputRevision: progressBoundary.payload?.inputRevision ?? null,
          },
          scopeBoundary: {
            shouldEmit: scopeBoundary.shouldEmit,
            reason: scopeBoundary.reason,
            fingerprint: scopeBoundary.payload?.fingerprint ?? null,
          },
          emitted,
          quiescent,
          quiescentReason: quiescent
            ? queueBlocked
              ? "work is dependency-blocked"
              : "no autonomy routing condition matched"
            : null,
        };
      },
    },
  ],
};

export default dispatcherWorkflow;
