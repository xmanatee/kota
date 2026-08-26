import {
  enqueueOwnerQuestion,
  resolveGeneratedWork,
  writeFollowUpTask,
} from "./action-writers.js";
import {
  progressReviewFindingGroupEntries,
  validateProgressReviewEvidenceIds,
} from "./agent-output.js";
import { readTaskStatus } from "./task-status.js";
import type {
  ProgressReviewActionResult,
  ProgressReviewAgentOutput,
  ProgressReviewAppliedAction,
  ProgressReviewEvidenceIdPacket,
} from "./types.js";

export { readTaskStatus };

export function applyProgressReviewActions(args: {
  workspaceRoot: string;
  runId: string;
  evidence: ProgressReviewEvidenceIdPacket;
  review: ProgressReviewAgentOutput;
}): ProgressReviewActionResult {
  validateProgressReviewEvidenceIds({ evidence: args.evidence, review: args.review });
  const applied: ProgressReviewAppliedAction[] = [];
  for (const { group } of progressReviewFindingGroupEntries(args.review)) {
    for (const task of group.followUpTasks) {
      applied.push(writeFollowUpTask({ ...args, task }));
    }
  }
  for (const question of args.review.ownerQuestions) {
    applied.push(...enqueueOwnerQuestion({ ...args, question }));
  }
  for (const resolution of args.review.resolutions ?? []) {
    applied.push(...resolveGeneratedWork({
      workspaceRoot: args.workspaceRoot,
      resolution,
    }));
  }
  return summarizeAppliedActions(applied);
}

function summarizeAppliedActions(
  applied: ProgressReviewAppliedAction[],
): ProgressReviewActionResult {
  const createdTaskIds = applied
    .filter((action): action is Extract<ProgressReviewAppliedAction, { kind: "created-task" }> =>
      action.kind === "created-task"
    )
    .map((action) => action.taskId);
  const ownerQuestionIds = applied
    .filter((action): action is Extract<ProgressReviewAppliedAction, { kind: "owner-question" }> =>
      action.kind === "owner-question"
    )
    .map((action) => action.questionId);
  const touchedTaskQueue = applied.some(
    (action) =>
      action.kind === "created-task" ||
      action.kind === "updated-task" ||
      action.kind === "dropped-task",
  );
  return {
    createdTaskIds,
    ownerQuestionIds,
    applied,
    touchedTaskQueue,
  };
}
