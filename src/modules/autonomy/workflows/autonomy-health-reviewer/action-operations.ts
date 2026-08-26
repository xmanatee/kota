import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import type {
  AutonomyIssueProjection,
} from "#modules/autonomy/autonomy-issue-projection.js";
import {
  type AutonomyHealthReviewActionResult,
  stageAutonomyHealthReviewActions,
} from "./health-review.js";

export type StageHealthReviewActionsInput = {
  projectDir: string;
  currentProjection: AutonomyIssueProjection;
  review: Parameters<typeof stageAutonomyHealthReviewActions>[0]["review"];
};

export type StageHealthReviewActionsOutput = {
  actions: AutonomyHealthReviewActionResult;
};

export function stageAutonomyHealthReviewActionsInWorker(
  input: StageHealthReviewActionsInput,
): StageHealthReviewActionsOutput {
  return { actions: stageAutonomyHealthReviewActions(input) };
}

export const stageAutonomyHealthReviewActionsOperation =
  defineWorkflowBlockingOperation<
    StageHealthReviewActionsInput,
    StageHealthReviewActionsOutput
  >(import.meta.url, "stageAutonomyHealthReviewActionsInWorker");
