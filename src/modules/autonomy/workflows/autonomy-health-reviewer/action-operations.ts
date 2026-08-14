import type { BusEvents } from "#core/events/event-bus.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  type AutonomyHealthReview,
  type AutonomyHealthReviewActionResult,
  applyAutonomyHealthReviewActions,
} from "./health-review.js";

type OwnerQuestionAskedPayload = Omit<
  BusEvents["owner.question.asked"],
  "projectId" | "scopeId"
>;

type ApplyAutonomyHealthReviewActionsInput = {
  projectDir: string;
  runId: string;
  review: AutonomyHealthReview;
  nowIso: string;
};

export type ApplyAutonomyHealthReviewActionsOutput = {
  actions: AutonomyHealthReviewActionResult;
  ownerQuestionEvents: OwnerQuestionAskedPayload[];
};

export function applyAutonomyHealthReviewActionsInWorker(
  input: ApplyAutonomyHealthReviewActionsInput,
): ApplyAutonomyHealthReviewActionsOutput {
  const ownerQuestionEvents: OwnerQuestionAskedPayload[] = [];
  const actions = applyAutonomyHealthReviewActions({
    ...input,
    emitOwnerQuestionAsked: (payload) => ownerQuestionEvents.push(payload),
  });
  return { actions, ownerQuestionEvents };
}

export const applyAutonomyHealthReviewActionsOperation =
  defineWorkflowBlockingOperation<
    ApplyAutonomyHealthReviewActionsInput,
    ApplyAutonomyHealthReviewActionsOutput
  >(import.meta.url, "applyAutonomyHealthReviewActionsInWorker");
