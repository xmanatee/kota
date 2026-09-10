import { join } from "node:path";
import { z } from "zod";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { readOptionalJsonFile, writeJsonFileAtomic } from "#core/util/json-file.js";
import type { WorkflowFinalizationContext } from "#core/workflow/types.js";
import { autonomyIssueDecisionRequested, autonomyIssueInvestigationKey } from "#modules/autonomy/autonomy-issue-events.js";
import { AUTONOMY_ISSUE_PROJECTION_STATE_KEY, type AutonomyIssueProjection, decodeAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.js";
import { stageAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection-publication.js";
import { applyGeneratedWorkQuestionDismissal, generatedWorkQuestionDedupeKey } from "#modules/autonomy/generated-work-owner-question.js";
import { normalizeGeneratedWorkProposalKey } from "#modules/autonomy/generated-work-proposal.js";
import { applyAutonomyHealthReviewActions } from "./health-review-actions.js";
import { AUTONOMY_HEALTH_REVIEW_ARTIFACT, buildAutonomyHealthAttentionDigest } from "./health-review-artifact.js";
import type { AutonomyHealthReviewArtifact } from "./health-review-types.js";

const dismissalArtifact = z.object({
  actions: z.object({
    ownerQuestionDismissals: z.array(z.object({
      questionId: z.string().regex(/^[a-f0-9]{8}$/),
      questionRevision: z.string().regex(/^[a-f0-9]{64}$/),
      reason: z.string().trim().min(1),
      resolutionSource: z.string().trim().min(1),
    })),
  }),
});

export function finalizeAutonomyHealthReview(ctx: WorkflowFinalizationContext): void {
  const artifactPath = join(ctx.stateDir, "runs", ctx.runId, AUTONOMY_HEALTH_REVIEW_ARTIFACT);
  const artifact = readOptionalJsonFile<AutonomyHealthReviewArtifact>(artifactPath);
  if (artifact === null) throw new Error("Health review artifact is missing");
  const retained = dismissalArtifact.parse(artifact);
  const queue = new OwnerQuestionQueue(join(ctx.scopeRoot, ".kota", "owner-questions"));
  const snapshot = ctx.state.read<AutonomyIssueProjection>(AUTONOMY_ISSUE_PROJECTION_STATE_KEY);
  const current = decodeAutonomyIssueProjection(snapshot.value);
  const { projection, ...actions } = applyAutonomyHealthReviewActions({
    currentProjection: current,
    ownerQuestionQueue: queue,
    review: artifact.review,
    plannedActions: artifact.actions,
  });
  const dismissals = new Map(retained.actions.ownerQuestionDismissals.map(
    (dismissal) => [dismissal.questionId, dismissal],
  ));
  for (const dismissal of actions.ownerQuestionDismissals) {
    if (!dismissals.has(dismissal.questionId)) dismissals.set(dismissal.questionId, dismissal);
  }
  if (dismissals.size > retained.actions.ownerQuestionDismissals.length) {
    // Pin newly linked revisions before file effects so a DB rollback can replay them.
    writeJsonFileAtomic(artifactPath, {
      ...artifact,
      actions: { ...artifact.actions, ownerQuestionDismissals: [...dismissals.values()] },
    });
  }
  stageAutonomyIssueProjection({
    state: ctx.state, key: AUTONOMY_ISSUE_PROJECTION_STATE_KEY,
    revision: snapshot.revision, current, next: projection,
  });
  for (const [index, request] of actions.applied.entries()) {
    if (request.kind !== "decision-requested") continue;
    ctx.emit(autonomyIssueDecisionRequested.name, {
      issueKey: request.issueKey, rootCauseKey: request.dedupeKey,
      semanticRevision: request.semanticRevision, transition: request.transition,
      observedAt: artifact.review.generatedAt, requestKind: "transition",
      idempotencyKey: autonomyIssueInvestigationKey(request.issueKey, request.semanticRevision, 0),
    }, `emit-decision-request:${request.issueKey}:${request.semanticRevision}:${index}`);
  }
  if (actions.applied.length > 0) {
    ctx.emit("workflow.attention.digest", buildAutonomyHealthAttentionDigest({
      review: artifact.review, actions,
    }), "emit-attention");
  }
  for (const dismissal of dismissals.values()) {
    const question = queue.get(dismissal.questionId);
    const remainsResolved = projection.issues.some((issue) =>
      issue.status === "resolved" && (
        issue.links.ownerQuestionIds.includes(dismissal.questionId) ||
        current.issues.find((prior) => prior.issueKey === issue.issueKey)
          ?.links.ownerQuestionIds.includes(dismissal.questionId) ||
        question?.dedupeKey === generatedWorkQuestionDedupeKey(
          normalizeGeneratedWorkProposalKey(`autonomy-issue:${issue.issueKey}`),
        )
      )
    );
    if (!remainsResolved) continue;
    if (!applyGeneratedWorkQuestionDismissal(queue, dismissal)) continue;
    ctx.emit("owner.question.resolved", {
      id: dismissal.questionId, answered: false, answer: "",
    }, `owner-question-resolved:${dismissal.questionId}`);
    ctx.emit("owner.question.dismissed", {
      id: dismissal.questionId, reason: dismissal.reason,
    }, `owner-question-dismissed:${dismissal.questionId}`);
    ctx.emit("owner.question.changed", {
      id: dismissal.questionId, pendingCount: queue.count("pending"),
    }, `owner-question-changed:${dismissal.questionId}`);
  }
}
