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
  buildSecurityReviewDuePayload,
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
  // Dispatcher observes canonical state and never mutates it. Builder binds
  // task dispatches to immutable digests and revalidates them in its writer
  // sandbox, while semantic boundaries use durable compare-and-set state.
  // Keeping this repository-free also lets observe-only directory scopes
  // continue reflecting after their initial onboarding request.
  repository: "none",
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
        scopeRoot,
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
          deriveDirectoryScopeId(scopeRoot),
        );
        const scopeId = deriveDirectoryScopeId(scopeRoot);
        const securityReviewGitEvidence = await collectSecurityReviewGitEvidence({
          workspaceRoot: scopeRoot,
          scopeRoot,
          stateDir,
          runCommand,
        });
        const [inspection, progressBoundary] = await Promise.all([
          runBlocking(dispatcherInspectionOperation, {
            workspaceRoot: scopeRoot,
            scopeRoot,
            scopeId,
            stateDir,
            nowIso: new Date().toISOString(),
            scopePolicySnapshot: scopePolicySnapshot ?? null,
            scopeImprovementState,
            securityReviewGitEvidence,
          }),
          inspectProgressSemanticBoundary({
            workspaceRoot: scopeRoot,
            scopeRoot,
            stateDir,
            progressBoundaryState: progressState.value,
            runCommand,
          }),
        ]);
        const {
          queue,
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
        const queueActionable = builderTasks.length > 0;
        const blockedResearchAttemptable =
          researchRetryAvailability.attemptableCount > 0;
        const securityReviewPayload = buildSecurityReviewDuePayload(
          securityReviewDue,
        );
        const queueThin =
          queue.inboxCount === 0 &&
          queue.actionableCount > 0 &&
          queue.actionableCount <= 2;
        const publish = (
          event: string,
          payload: Record<string, unknown>,
          intent: string,
        ) =>
          emit(event, payload, {
            delivery: "on-run-success",
            stepId: `assess-and-dispatch:${intent}`,
          });

        if (queue.inboxCount > 0) {
          publish("autonomy.inbox.available", { inboxCount: queue.inboxCount }, "inbox");
        }
        if (queueActionable) {
          for (const task of builderTasks) {
            publish("autonomy.queue.available", task, `task:${task.taskId}`);
          }
        }
        if (queueEmpty) {
          publish(
            "autonomy.queue.empty",
            {
              counts: queue.counts,
              dependencyBlockedTasks: queue.dependencyBlockedTasks,
            },
            "queue-empty",
          );
        }
        if (blockedResearchAttemptable) {
          publish(
            "autonomy.blocked-research.attemptable",
            {
              candidateCount: researchRetryAvailability.candidateCount,
              attemptableCount: researchRetryAvailability.attemptableCount,
              counts: queue.counts,
            },
            "blocked-research",
          );
        }
        if (securityReviewDue.due) {
          publish(SECURITY_REVIEW_DUE_EVENT, securityReviewPayload, "security-review");
        }
        if (progressBoundary.shouldEmit && progressBoundary.payload) {
          publish(
            automaticProgressReviewRequested.name,
            progressBoundary.payload,
            "progress-review",
          );
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
          publish(scopeBoundaryEvent!, scopeBoundary.payload, "scope-improvement");
        }
        if (queueThin) {
          publish(
            "autonomy.queue.thin",
            {
              actionableCount: queue.actionableCount,
              dispatchableCount: queue.dispatchableCount,
              dependencyBlockedTasks: queue.dependencyBlockedTasks,
              counts: queue.counts,
            },
            "queue-thin",
          );
        }
        const emitted = [
          queue.inboxCount > 0 && "autonomy.inbox.available",
          ...builderTasks.map(() => queueActionable && "autonomy.queue.available"),
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
          actionableCount: queue.actionableCount,
          dispatchableCount: queue.dispatchableCount,
          dependencyBlockedTasks: queue.dependencyBlockedTasks,
          builderTaskIds: builderTasks.map((task) => task.taskId),
          researchRetryCandidateCount: researchRetryAvailability.candidateCount,
          researchRetryAttemptableCount: researchRetryAvailability.attemptableCount,
          securityReviewDue: securityReviewPayload,
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
