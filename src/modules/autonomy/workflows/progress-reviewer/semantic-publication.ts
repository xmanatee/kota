import { createHash } from "node:crypto";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { WorkflowFinalizationContext } from "#core/workflow/types.js";
import { createGeneratedWorkQuestionQueue } from "#modules/autonomy/generated-work-owner-question.js";
import { canPublishGeneratedWorkOwnerEffects, finalizeGeneratedWorkOwnerEffects } from "#modules/autonomy/generated-work-proposal.js";
import { findGeneratedWorkTask } from "#modules/autonomy/generated-work-task.js";
import { improvementHandoffRequested } from "#modules/autonomy/improvement-handoff.js";
import {
  progressReviewOwnerQuestionProposal,
  progressReviewResolutionProposal,
  progressReviewTaskProposal,
} from "./progress-review/action-writers.js";
import { progressReviewFindingGroupEntries } from "./progress-review/agent-output.js";
import type { ProgressReviewArtifact } from "./progress-review.js";
import { PROGRESS_REVIEW_ARTIFACT } from "./progress-review.js";
import {
  completeProgressReviewSemanticInput,
  decodeProgressReviewConsumptionState,
  PROGRESS_REVIEW_STATE_KEY,
  type ProgressReviewConsumptionState,
  planProgressReviewPublication,
} from "./semantic-input.js";
import type { PendingProgressReviewHandoff } from "./semantic-input-state.js";
import { inspectSemanticInput, recordReviewRejection } from "./workflow-steps.js";

export function finalizeProgressReview(ctx: WorkflowFinalizationContext): void {
  const snapshot = ctx.state.read<ProgressReviewConsumptionState>(PROGRESS_REVIEW_STATE_KEY);
  const currentState = decodeProgressReviewConsumptionState(snapshot.value, ctx.scopeRoot);
  if (currentState.scopeId !== deriveDirectoryScopeId(ctx.scopeRoot)) {
    throw new Error("progress review state belongs to another scope");
  }
  if (recordReviewRejection.output(ctx)) {
    const next = completeProgressReviewSemanticInput({
      current: currentState, input: inspectSemanticInput.outputRequired(ctx), consumedAt: new Date().toISOString(),
    });
    if (next !== currentState) ctx.state.compareAndSet(PROGRESS_REVIEW_STATE_KEY, snapshot.revision, next);
    return;
  }
  const result = publishProgressReview({
    scopeRoot: ctx.scopeRoot,
    sourceRunId: ctx.runId,
    currentState,
  });
  if (!isDeepStrictEqual(result.nextState, currentState)) {
    ctx.state.compareAndSet(PROGRESS_REVIEW_STATE_KEY, snapshot.revision, result.nextState);
  }
  for (const handoff of result.handoffs) {
    ctx.emit(improvementHandoffRequested.name, progressReviewHandoffPayload(handoff), `progress-review:${handoff.topicKey}`);
  }
}

function decodeArtifact(value: unknown): ProgressReviewArtifact {
  const artifact = value as Partial<ProgressReviewArtifact>;
  if (
    typeof artifact.generatedAt !== "string" ||
    !artifact.evidence ||
    !artifact.evidence.semanticInput
  ) {
    throw new Error("progress review artifact is invalid");
  }
  return artifact as ProgressReviewArtifact;
}

/** Finalize idempotent owner effects against the successfully integrated task state. */
export function publishProgressReview(args: {
  scopeRoot: string;
  sourceRunId: string;
  currentState: ProgressReviewConsumptionState;
}): {
  handoffs: PendingProgressReviewHandoff[];
  disposition: "absent" | "published";
  nextState: ProgressReviewConsumptionState;
} {
  const sourceRunDir = join(
    args.scopeRoot,
    ".kota",
    "runs",
    args.sourceRunId,
  );
  const artifact = readOptionalJsonFile<unknown>(
    join(sourceRunDir, PROGRESS_REVIEW_ARTIFACT),
  );
  if (artifact === null) {
    return { disposition: "absent", nextState: args.currentState, handoffs: [] };
  }
  const decoded = decodeArtifact(artifact);
  const proposals = [
    ...progressReviewFindingGroupEntries(decoded.review).flatMap(({ group }) =>
      group.followUpTasks.map((task) => progressReviewTaskProposal({
        runId: args.sourceRunId, review: decoded.review, task,
      })),
    ),
    ...decoded.review.ownerQuestions.map((question) =>
      progressReviewOwnerQuestionProposal({ runId: args.sourceRunId, question }),
    ),
    ...(decoded.review.resolutions ?? []).map(progressReviewResolutionProposal),
  ];
  const { replay, freshProposalKeys, nextState: plannedState } = planProgressReviewPublication({
    current: args.currentState,
    input: decoded.evidence.semanticInput,
    sourceRunId: args.sourceRunId,
    generatedAt: decoded.generatedAt,
    proposalKeys: [...proposals.map((proposal) => proposal.proposalKey), ...(decoded.review.handoffs ?? []).map((handoff) => handoff.topicKey)],
  });
  const nextState = {
    ...plannedState,
    proposalObservations: plannedState.proposalObservations.map((entry) => ({ ...entry })),
  };
  const proposalArgs = {
    workspaceRoot: args.scopeRoot,
    ownerQuestionQueue: createGeneratedWorkQuestionQueue(args.scopeRoot),
  };
  if (!replay) {
    for (const proposal of proposals) {
      const fresh = freshProposalKeys.has(proposal.proposalKey);
      if (!canPublishGeneratedWorkOwnerEffects({ ...proposalArgs, proposal, fresh })) continue;
      if (proposal.kind !== "task") {
        const observation = nextState.proposalObservations.find((entry) => entry.proposalKey === proposal.proposalKey);
        // An unrelated consumed revision cannot release work rejected by the
        // canonical disposition. A newer observation on this topic still wins.
        if (observation?.pendingHandoff && observation.generatedAt <= decoded.generatedAt) {
          delete observation.pendingHandoff;
          observation.generatedAt = decoded.generatedAt;
        }
      }
      finalizeGeneratedWorkOwnerEffects({ ...proposalArgs, proposal });
    }
  }
  for (const handoff of decoded.review.handoffs ?? []) {
    if (!freshProposalKeys.has(handoff.topicKey)) continue;
    const evidenceIds = [...new Set(handoff.evidenceIds)].sort();
    const fingerprint = createHash("sha256").update(JSON.stringify({
      owner: handoff.owner,
      topicKey: handoff.topicKey,
      targetScope: handoff.targetScope,
      evidenceIds,
      evidence: evidenceIds.map((id) => decoded.evidence.evidence.find((entry) => entry.id === id)),
    })).digest("hex");
    const observation = nextState.proposalObservations.find((entry) => entry.proposalKey === handoff.topicKey);
    if (!observation) throw new Error("fresh handoff has no publication observation");
    if (observation.handoffFingerprint === fingerprint || observation.pendingHandoff?.evidenceFingerprint === fingerprint) continue;
    observation.pendingHandoff = {
      ...handoff,
      evidenceFingerprint: fingerprint,
      evidenceRefs: [join(sourceRunDir, PROGRESS_REVIEW_ARTIFACT), ...evidenceIds.flatMap((id) => {
        const ref = decoded.evidence.evidence.find((entry) => entry.id === id);
        return ref?.path ? [ref.path] : [];
      })],
    };
  }
  return {
    ...reconcileProgressReviewHandoffs({ scopeRoot: args.scopeRoot, currentState: nextState }),
    disposition: "published",
  };
}

/** Reconcile accepted evidence independently of admission to another agent review. */
export function reconcileProgressReviewHandoffs(args: {
  scopeRoot: string;
  currentState: ProgressReviewConsumptionState;
}): { handoffs: PendingProgressReviewHandoff[]; nextState: ProgressReviewConsumptionState } {
  const nextState = {
    ...args.currentState,
    proposalObservations: args.currentState.proposalObservations.map((entry) => ({ ...entry })),
  };
  const handoffs: PendingProgressReviewHandoff[] = [];
  for (const observation of nextState.proposalObservations) {
    const handoff = observation.pendingHandoff;
    if (!handoff) continue;
    const task = findGeneratedWorkTask(args.scopeRoot, handoff.topicKey)?.task;
    if (task?.state === "open" || task?.state === "blocked") continue;
    handoffs.push(handoff);
    observation.handoffFingerprint = handoff.evidenceFingerprint;
    delete observation.pendingHandoff;
  }
  return { handoffs, nextState };
}

export function progressReviewHandoffPayload(handoff: PendingProgressReviewHandoff) {
  return {
    owner: handoff.owner, topicKey: handoff.topicKey, targetScope: handoff.targetScope,
    reason: handoff.reason, evidenceRefs: handoff.evidenceRefs, requestedBy: "progress-reviewer",
    evidenceFingerprint: handoff.evidenceFingerprint,
    idempotencyKey: `improvement-handoff:${handoff.evidenceFingerprint}`,
  };
}
