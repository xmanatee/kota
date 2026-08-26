import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import type {
  AutonomyIssueProjection,
} from "#modules/autonomy/autonomy-issue-projection.js";
import {
  type AutonomyHealthReviewActionResult,
  planAutonomyHealthReviewActions,
} from "./health-review.js";

export type PlanHealthReviewActionsInput = {
  workspaceRoot: string;
  currentProjection: AutonomyIssueProjection;
  review: Parameters<typeof planAutonomyHealthReviewActions>[0]["review"];
};

export type PlanHealthReviewActionsOutput = {
  actions: AutonomyHealthReviewActionResult;
};

export function planAutonomyHealthReviewActionsInWorker(
  input: PlanHealthReviewActionsInput,
): PlanHealthReviewActionsOutput {
  return { actions: planAutonomyHealthReviewActions(input) };
}

export const planAutonomyHealthReviewActionsOperation =
  defineWorkflowBlockingOperation<
    PlanHealthReviewActionsInput,
    PlanHealthReviewActionsOutput
  >(import.meta.url, "planAutonomyHealthReviewActionsInWorker");
