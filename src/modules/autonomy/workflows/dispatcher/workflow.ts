import { createHash } from "node:crypto";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { readOptionalJsonFile, writeJsonFileAtomic } from "#core/util/json-file.js";
import { expectStructuredOutput } from "#core/workflow/step-input-code.js";
import type { WorkflowDefinitionInput, WorkflowFinalizationContext } from "#core/workflow/types.js";
import { improvementHandoffRequested } from "#modules/autonomy/improvement-handoff.js";
import { assessAutonomyQueue } from "#modules/autonomy/queue-policy.js";
import { resolveRepoWorkSupplyInput } from "#modules/repo-tasks/work-supply.js";
import { automaticProgressReviewRequested } from "../progress-reviewer/events.js";
import { decodeProgressReviewConsumptionState, PROGRESS_REVIEW_STATE_KEY } from "../progress-reviewer/semantic-input.js";
import { progressReviewHandoffPayload, reconcileProgressReviewHandoffs } from "../progress-reviewer/semantic-publication.js";
import { availableResearchSourceTools } from "../research-retry/precondition.js";
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
  reconcileSecurityReviewObservation,
  SECURITY_REVIEW_DUE_EVENT,
  type SecurityReviewGitEvidence,
} from "../security-review/due-check.js";
import { securityFindingPublicationRequested } from "../security-review/events.js";
import { reconcileSecurityEvidenceRecovery, securityEvidenceRecoveryOperation } from "../security-review/evidence-recovery.js";
import { decodeSecurityReviewState, SECURITY_REVIEW_STATE_KEY, type SecurityReviewState, validateSecurityReviewState } from "../security-review/review-state.js";
import { resolvePendingSecurityFindings } from "../security-review/security-review-task-identity.js";
import { type DispatcherInspection, dispatcherInspectionOperation } from "./inspection.js";
import {
  inspectProgressSemanticBoundary,
  PROGRESS_BOUNDARY_STATE_KEY,
  type ProgressBoundaryInspection,
  type ProgressBoundaryState,
  reserveObservedProgressBoundary,
} from "./semantic-reflection.js";

import { reserveObservedScopeBoundary } from "./semantic-scope-reflection.js";

type DispatcherObservation = {
  inspection: DispatcherInspection;
  progressBoundary: ProgressBoundaryInspection;
  progressState: unknown;
  scopeImprovementState: ScopeImprovementState;
  securityState: SecurityReviewState;
  securityEvidenceRecovery: SecurityReviewState["recovery"];
  securityReviewGitEvidence: SecurityReviewGitEvidence;
};

// Only this synchronous reduction owns reservations, receipts and publications.
// Canonical scans remain ordinary run evidence; durable rows are read afresh here.
export function finalizeDispatcher(ctx: WorkflowFinalizationContext): void {
  const { scopeRoot, stateDir, scopeId, state } = ctx;
  const observation = expectStructuredOutput<DispatcherObservation>(
    readOptionalJsonFile(join(stateDir, "runs", ctx.runId, "dispatcher-observation.json")),
    ["inspection", "progressBoundary", "progressState", "scopeImprovementState", "securityState", "securityEvidenceRecovery", "securityReviewGitEvidence"],
  );
  const progressState = state.read<ProgressBoundaryState>(PROGRESS_BOUNDARY_STATE_KEY);
  const consumptionSnapshot = state.read(PROGRESS_REVIEW_STATE_KEY);
  const consumptionState = decodeProgressReviewConsumptionState(consumptionSnapshot.value, scopeRoot);
  const progressBoundary = reserveObservedProgressBoundary({
    observedState: observation.progressState, currentState: progressState.value,
    consumedRevision: consumptionState.lastConsumedRevision, inspection: observation.progressBoundary,
  });
  const scopeState = state.read<ScopeImprovementState>(SCOPE_IMPROVEMENT_STATE_KEY);
  const scopeBoundary = reserveObservedScopeBoundary(
    observation.scopeImprovementState, decodeScopeImprovementState(scopeState.value, scopeId), observation.inspection.scopeBoundary,
  );
  const securitySnapshot = state.read(SECURITY_REVIEW_STATE_KEY);
  const currentSecurityState = decodeSecurityReviewState(securitySnapshot.value);
  const security = reconcileSecurityReviewObservation({
    observedState: observation.securityState, currentState: currentSecurityState,
    git: observation.securityReviewGitEvidence, inspection: observation.inspection.securityReviewDue, stateDir,
  });
  const securityState = security.nextState;
  reconcileSecurityEvidenceRecovery(securityState, observation.securityEvidenceRecovery, join(stateDir, "runs", ctx.runId));
  const securityReviewDue = security.due;
  if (!isDeepStrictEqual(securityState, securitySnapshot.value)) {
    state.compareAndSet(SECURITY_REVIEW_STATE_KEY, securitySnapshot.revision, validateSecurityReviewState(securityState));
  }
  const { queue, researchRetryAvailability, builderTasks } = observation.inspection;
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
  const queueDecision = assessAutonomyQueue(queue);
  const queueActionable = builderTasks.length > 0;
  const blockedResearchAttemptable =
    researchRetryAvailability.attemptableCount > 0;
  const securityReviewPayload = buildSecurityReviewDuePayload(
    securityReviewDue,
  );
  const emitted: string[] = [];
  const publish = (
    event: string,
    payload: Record<string, unknown>,
    intent: string,
  ) => {
    ctx.emit(event, payload, `assess-and-dispatch:${intent}`);
    emitted.push(event);
  };

  const handoffResult = reconcileProgressReviewHandoffs({ scopeRoot, currentState: consumptionState });
  if (!isDeepStrictEqual(handoffResult.nextState, consumptionState)) {
    state.compareAndSet(PROGRESS_REVIEW_STATE_KEY, consumptionSnapshot.revision, handoffResult.nextState);
  }
  for (const handoff of handoffResult.handoffs) {
    publish(improvementHandoffRequested.name, progressReviewHandoffPayload(handoff), `handoff:${handoff.topicKey}`);
  }

  if (queue.inboxCount > 0) {
    publish("autonomy.inbox.available", { inboxCount: queue.inboxCount }, "inbox");
  }
  if (queueActionable) {
    for (const task of builderTasks) {
      publish("autonomy.queue.available", task, `task:${task.taskId}`);
    }
  }
  if (queueDecision.empty) {
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
  const parkedSecurityPublications: Array<{ findingId: string; reason: string }> = [];
  if (queue.ownershipAvailable) {
    const pendingTasks = new Map<string, string[]>();
    const { resolved, parked } = resolvePendingSecurityFindings(scopeRoot, securityState.pending);
    parkedSecurityPublications.push(...parked);
    for (const { target: { id, evidenceKey } } of resolved) {
      if (queue.owners.some((owner) => owner.taskId === id)) continue;
      pendingTasks.set(id, [...(pendingTasks.get(id) ?? []), evidenceKey]);
    }
    for (const [taskId, evidence] of pendingTasks) {
      publish(securityFindingPublicationRequested.name, {
        scopeId, taskId,
        idempotencyKey: `security-publication:${taskId}:${createHash("sha256").update(evidence.sort().join(":")).digest("hex")}`,
      }, `security-publication:${taskId}`);
    }
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
  if (queueDecision.thin) {
    publish(
      "autonomy.queue.thin",
      {
        actionableCount: queue.availableCount,
        dispatchableCount: queue.dispatchableCount,
        dependencyBlockedTasks: queue.dependencyBlockedTasks,
        counts: queue.counts,
      },
      "queue-thin",
    );
  }
  const quiescent = emitted.length === 0;

  writeJsonFileAtomic(join(stateDir, "runs", ctx.runId, "dispatcher-decision.json"), {
    ...queue,
    queueDecision,
    inboxCount: queue.inboxCount,
    actionableCount: queue.actionableCount,
    dispatchableCount: queue.dispatchableCount,
    dependencyBlockedTasks: queue.dependencyBlockedTasks,
    builderTaskIds: builderTasks.map((task) => task.taskId),
    researchRetryCandidateCount: researchRetryAvailability.candidateCount,
    researchRetryAttemptableCount: researchRetryAvailability.attemptableCount,
    securityReviewDue: securityReviewPayload,
    parkedSecurityPublications,
    securityEvidenceRecovery: securityState.recovery,
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
      ? queueDecision.dependencyBlocked
        ? "work is dependency-blocked"
        : "no autonomy routing condition matched"
      : null,
  });
}

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
  finalize: finalizeDispatcher,
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
      rerunOnRetry: true,
      run: async ({
        scopeRoot,
        stateDir,
        workflow,
        runtimeStateDir,
        state,
        runBlocking,
        runCommand,
        scopePolicySnapshot,
      }) => {
        const progressState = state.read<ProgressBoundaryState>(
          PROGRESS_BOUNDARY_STATE_KEY,
        );
        const consumptionSnapshot = state.read(PROGRESS_REVIEW_STATE_KEY);
        const consumptionState = decodeProgressReviewConsumptionState(consumptionSnapshot.value, scopeRoot);
        const scopeState = state.read<ScopeImprovementState>(
          SCOPE_IMPROVEMENT_STATE_KEY,
        );
        const scopeImprovementState = decodeScopeImprovementState(
          scopeState.value,
          deriveDirectoryScopeId(scopeRoot),
        );
        const scopeId = deriveDirectoryScopeId(scopeRoot);
        const securitySnapshot = state.read(SECURITY_REVIEW_STATE_KEY);
        const securityState = decodeSecurityReviewState(securitySnapshot.value);
        const securityReviewGitEvidence = await collectSecurityReviewGitEvidence({
          workspaceRoot: scopeRoot,
          scopeRoot,
          stateDir,
          runCommand,
          reviewState: securityState,
        });
        const [inspection, progressBoundary, securityEvidenceRecovery] = await Promise.all([
          runBlocking(dispatcherInspectionOperation, {
            workspaceRoot: scopeRoot,
            scopeRoot,
            stateDir,
            scopeId,
            workSupplyInput: resolveRepoWorkSupplyInput({ workspaceRoot: scopeRoot, scopeRoot, stateDir: runtimeStateDir }),
            nowIso: new Date().toISOString(),
            scopePolicySnapshot: scopePolicySnapshot ?? null,
            researchSourceTools: availableResearchSourceTools(scopePolicySnapshot?.policy),
            scopeImprovementState,
            securityReviewGitEvidence,
          }),
          inspectProgressSemanticBoundary({
            workspaceRoot: scopeRoot,
            scopeRoot,
            stateDir,
            runtimeStateDir,
            progressBoundaryState: progressState.value,
            consumedRevision: consumptionState.lastConsumedRevision,
            runCommand,
          }),
          runBlocking(securityEvidenceRecoveryOperation, { state: securityState, stateDir, runtimeStateDir, scopeId }),
        ]);
        const observation: DispatcherObservation = {
          inspection, progressBoundary, progressState: progressState.value,
          scopeImprovementState, securityState, securityReviewGitEvidence, securityEvidenceRecovery,
        };
        writeJsonFileAtomic(join(workflow.runDirPath, "dispatcher-observation.json"), observation);
        return { availableTasks: inspection.builderTasks.length };
      },
    },
  ],
};

export default dispatcherWorkflow;
