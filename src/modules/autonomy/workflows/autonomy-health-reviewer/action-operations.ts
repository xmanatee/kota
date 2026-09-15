import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import { type AutonomyIssueProjection, decodeAutonomyIssueProjection } from "#modules/autonomy/autonomy-issue-projection.js";
import type { AutonomyHealthJsonObject } from "#modules/autonomy/health-signal.js";
import { buildAutonomyHealthReview, planAutonomyHealthReviewActions, writeAutonomyHealthReviewArtifact } from "./health-review.js";
import type { AutonomyHealthReviewActionResult } from "./health-review-types.js";

export type PrepareHealthReviewInput = {
  workspaceRoot: string;
  runDirPath: string;
  currentProjection: AutonomyIssueProjection | null;
  triggerPayload: WorkflowRunTrigger["payload"];
};

export type PrepareHealthReviewOutput = {
  artifactPath: string;
  signalCount: number;
  taskMutations: AutonomyHealthReviewActionResult["taskMutations"];
};

export function prepareAutonomyHealthReviewInWorker(input: PrepareHealthReviewInput): PrepareHealthReviewOutput {
  const review = buildAutonomyHealthReview({
    triggerPayload: input.triggerPayload as AutonomyHealthJsonObject,
    generatedAt: new Date().toISOString(),
  });
  const actions = planAutonomyHealthReviewActions({
    workspaceRoot: input.workspaceRoot,
    currentProjection: decodeAutonomyIssueProjection(input.currentProjection),
    review,
  });
  const artifactPath = writeAutonomyHealthReviewArtifact(input.runDirPath, {
    generatedAt: review.generatedAt, review, actions,
  });
  return { artifactPath, signalCount: review.signals.length, taskMutations: actions.taskMutations };
}

export const prepareAutonomyHealthReviewOperation = defineWorkflowBlockingOperation<
  PrepareHealthReviewInput, PrepareHealthReviewOutput
>(import.meta.url, "prepareAutonomyHealthReviewInWorker");
