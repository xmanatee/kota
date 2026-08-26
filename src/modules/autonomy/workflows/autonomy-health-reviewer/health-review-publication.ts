import { join } from "node:path";
import { OwnerQuestionQueue } from "#core/daemon/owner-question-queue.js";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { validateWorkflowRunId } from "#core/workflow/run-io.js";
import type { AutonomyIssueDecisionRequest } from "#modules/autonomy/autonomy-issue-events.js";
import type { AutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.js";
import {
  AUTONOMY_HEALTH_REVIEW_ARTIFACT,
  type AutonomyHealthReviewArtifact,
  buildAutonomyHealthAttentionDigest,
  finalizeAutonomyHealthReviewActions,
  planAutonomyHealthReviewFinalization,
} from "./health-review.js";

export const AUTONOMY_HEALTH_REVIEW_PUBLICATION_REQUESTED_EVENT =
  "autonomy.health-review.publication.requested";

export type AutonomyHealthReviewPublicationRequest = {
  publicationKey: string;
  sourceRunId: string;
  scopeId: string;
};

export type AutonomyHealthReviewPublicationResult = {
  published: boolean;
  decisionRequests: AutonomyIssueDecisionRequest[];
  attentionDigest: ReturnType<typeof buildAutonomyHealthAttentionDigest> | null;
};

export type AutonomyHealthReviewPublication = {
  result: AutonomyHealthReviewPublicationResult;
  nextProjection: AutonomyIssueProjection;
};

type PublicationInput = {
  scopeRoot: string;
  sourceRunId: string;
  scopeId: string;
};

export function autonomyHealthReviewPublicationKey(sourceRunId: string): string {
  return `autonomy-health-review-publication:${sourceRunId}`;
}

export function decodeAutonomyHealthReviewPublicationRequest(
  value: object,
): AutonomyHealthReviewPublicationRequest {
  const request = value as Partial<AutonomyHealthReviewPublicationRequest>;
  if (
    typeof request.sourceRunId !== "string" ||
    typeof request.scopeId !== "string"
  ) {
    throw new Error("autonomy health review publication request is invalid");
  }
  const sourceRunId = validateWorkflowRunId(
    request.sourceRunId,
    "Autonomy health review publication",
  );
  if (
    request.publicationKey !== autonomyHealthReviewPublicationKey(sourceRunId)
  ) {
    throw new Error("autonomy health review publication request is invalid");
  }
  return {
    publicationKey: request.publicationKey,
    sourceRunId,
    scopeId: request.scopeId,
  };
}

function decodeArtifact(value: unknown): AutonomyHealthReviewArtifact {
  const artifact = value as Partial<AutonomyHealthReviewArtifact>;
  if (
    typeof artifact.generatedAt !== "string" ||
    !artifact.review ||
    !Array.isArray(artifact.review.groups) ||
    !artifact.actions ||
    !Array.isArray(artifact.actions.applied) ||
    !Array.isArray(artifact.actions.taskMutationPaths)
  ) {
    throw new Error("autonomy health review publication artifact is invalid");
  }
  return artifact as AutonomyHealthReviewArtifact;
}

function readPublicationArtifact(
  args: PublicationInput,
): AutonomyHealthReviewArtifact | null {
  const artifact = readOptionalJsonFile<unknown>(
    join(
      args.scopeRoot,
      ".kota",
      "runs",
      args.sourceRunId,
      AUTONOMY_HEALTH_REVIEW_ARTIFACT,
    ),
  );
  if (artifact === null) return null;
  const decoded = decodeArtifact(artifact);
  if (decoded.review.scope.scopeId !== args.scopeId) {
    throw new Error(
      "autonomy health review artifact does not belong to its runtime scope",
    );
  }
  return decoded;
}

function publicationResult(
  artifact: AutonomyHealthReviewArtifact,
  actions: ReturnType<typeof planAutonomyHealthReviewFinalization>,
): AutonomyHealthReviewPublicationResult {
  return {
    published: true,
    decisionRequests: actions.applied.flatMap((action) =>
      action.kind === "decision-requested"
        ? [{
            issueKey: action.issueKey,
            rootCauseKey: action.dedupeKey,
            semanticRevision: action.semanticRevision,
            transition: action.transition,
            observedAt: artifact.review.generatedAt,
          }]
        : []
    ),
    attentionDigest: actions.applied.length > 0
      ? buildAutonomyHealthAttentionDigest({
          review: artifact.review,
          actions,
        })
      : null,
  };
}

/** Build the immutable event result before any canonical mutation occurs. */
export function planAutonomyHealthReviewPublication(
  args: PublicationInput & { currentProjection: AutonomyIssueProjection },
): AutonomyHealthReviewPublicationResult {
  const artifact = readPublicationArtifact(args);
  if (artifact === null) {
    return { published: false, decisionRequests: [], attentionDigest: null };
  }
  return publicationResult(
    artifact,
    planAutonomyHealthReviewFinalization({
      currentProjection: args.currentProjection,
      review: artifact.review,
      repositoryActions: artifact.actions,
    }),
  );
}

/** Finalize canonical health state from a repository:none follow-up run. */
export function publishAutonomyHealthReview(args: {
  scopeRoot: string;
  sourceRunId: string;
  scopeId: string;
  currentProjection: AutonomyIssueProjection;
  plan: AutonomyHealthReviewPublicationResult;
}): AutonomyHealthReviewPublication {
  const artifact = readPublicationArtifact(args);
  if (artifact === null) {
    if (args.plan.published) {
      throw new Error("autonomy health review publication artifact disappeared");
    }
    return { result: args.plan, nextProjection: args.currentProjection };
  }
  if (!args.plan.published) {
    throw new Error("autonomy health review publication plan is stale");
  }

  const finalized = finalizeAutonomyHealthReviewActions({
    currentProjection: args.currentProjection,
    ownerQuestionQueue: new OwnerQuestionQueue(
      join(args.scopeRoot, ".kota", "owner-questions"),
    ),
    review: artifact.review,
    repositoryActions: artifact.actions,
  });
  return { result: args.plan, nextProjection: finalized.projection };
}
