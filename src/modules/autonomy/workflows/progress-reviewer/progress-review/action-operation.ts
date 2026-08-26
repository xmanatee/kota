import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import { applyProgressReviewActions } from "./actions.js";
import type {
  ProgressReviewActionResult,
  ProgressReviewAgentOutput,
  ProgressReviewEvidenceIdPacket,
} from "./types.js";

export type ProgressReviewActionOperationInput = {
  projectDir: string;
  scopeDir: string;
  runId: string;
  evidence: ProgressReviewEvidenceIdPacket;
  review: ProgressReviewAgentOutput;
};

export function applyProgressReviewActionsInWorker(
  input: ProgressReviewActionOperationInput,
): ProgressReviewActionResult {
  return applyProgressReviewActions(input);
}

export const progressReviewActionOperation = defineWorkflowBlockingOperation<
  ProgressReviewActionOperationInput,
  ProgressReviewActionResult
>(import.meta.url, "applyProgressReviewActionsInWorker");
