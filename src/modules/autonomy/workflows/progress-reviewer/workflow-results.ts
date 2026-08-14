import type {
  ProgressReviewActionResult,
  ProgressReviewAgentOutput,
} from "./progress-review.js";

export function emptyActions(): ProgressReviewActionResult {
  return {
    createdTaskIds: [],
    ownerQuestionIds: [],
    applied: [],
    touchedTaskQueue: false,
  };
}

export function needsAttention(review: ProgressReviewAgentOutput): boolean {
  return review.verdict === "needs-steering" || review.verdict === "blocked";
}
