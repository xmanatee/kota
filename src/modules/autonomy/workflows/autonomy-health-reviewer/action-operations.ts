import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  type AutonomyHealthReviewActionResult,
  applyAutonomyHealthReviewActions,
} from "./health-review.js";

export type ApplyHealthReviewActionsInput = {
  projectDir: string;
  review: Parameters<typeof applyAutonomyHealthReviewActions>[0]["review"];
};

export type ApplyHealthReviewActionsOutput = {
  actions: AutonomyHealthReviewActionResult;
};

export function applyAutonomyHealthReviewActionsInWorker(
  input: ApplyHealthReviewActionsInput,
): ApplyHealthReviewActionsOutput {
  return { actions: applyAutonomyHealthReviewActions(input) };
}

export const applyAutonomyHealthReviewActionsOperation =
  defineWorkflowBlockingOperation<
    ApplyHealthReviewActionsInput,
    ApplyHealthReviewActionsOutput
  >(import.meta.url, "applyAutonomyHealthReviewActionsInWorker");
