import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import { validateWorkflowRunId } from "#core/workflow/run-io.js";
import { createGeneratedWorkQuestionQueue } from "#modules/autonomy/generated-work-owner-question.js";
import { canPublishGeneratedWorkOwnerEffects, finalizeGeneratedWorkOwnerEffects } from "#modules/autonomy/generated-work-proposal.js";
import {
  progressReviewOwnerQuestionProposal,
  progressReviewResolutionProposal,
  progressReviewTaskProposal,
} from "./progress-review/action-writers.js";
import { progressReviewFindingGroupEntries } from "./progress-review/agent-output.js";
import type { ProgressReviewArtifact } from "./progress-review.js";
import { PROGRESS_REVIEW_ARTIFACT } from "./progress-review.js";
import {
  type ProgressReviewConsumptionState,
  planProgressReviewPublication,
} from "./semantic-input.js";

export const PROGRESS_REVIEW_PUBLICATION_REQUESTED_EVENT =
  "autonomy.progress-review.publication.requested";
export const PROGRESS_REVIEW_PUBLICATION_RESOURCE =
  "autonomy:progress-review-publication";

export type ProgressReviewPublicationRequest = {
  publicationKey: string;
  sourceRunId: string;
};

export function progressReviewPublicationKey(sourceRunId: string): string {
  return `progress-review-publication:${sourceRunId}`;
}

export function decodeProgressReviewPublicationRequest(
  value: object,
): ProgressReviewPublicationRequest {
  const request = value as Partial<ProgressReviewPublicationRequest>;
  if (typeof request.sourceRunId !== "string") {
    throw new Error("progress review publication request is invalid");
  }
  const sourceRunId = validateWorkflowRunId(
    request.sourceRunId,
    "Progress review publication",
  );
  if (request.publicationKey !== progressReviewPublicationKey(sourceRunId)) {
    throw new Error("progress review publication request is invalid");
  }
  return { publicationKey: request.publicationKey, sourceRunId };
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

/** Advance canonical owner/runtime state from a post-integration follow-up run. */
export function publishProgressReview(args: {
  scopeRoot: string;
  sourceRunId: string;
  currentState: ProgressReviewConsumptionState;
}): {
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
    return { disposition: "absent", nextState: args.currentState };
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
  const { replay, freshProposalKeys, nextState } = planProgressReviewPublication({
    current: args.currentState,
    input: decoded.evidence.semanticInput,
    sourceRunId: args.sourceRunId,
    generatedAt: decoded.generatedAt,
    proposalKeys: proposals.map((proposal) => proposal.proposalKey),
  });
  const proposalArgs = {
    workspaceRoot: args.scopeRoot,
    ownerQuestionQueue: createGeneratedWorkQuestionQueue(args.scopeRoot),
  };
  if (!replay) {
    for (const proposal of proposals) {
      const fresh = freshProposalKeys.has(proposal.proposalKey);
      if (!canPublishGeneratedWorkOwnerEffects({ ...proposalArgs, proposal, fresh })) continue;
      finalizeGeneratedWorkOwnerEffects({ ...proposalArgs, proposal });
    }
  }
  return {
    disposition: "published",
    nextState,
  };
}
