import {
  enqueueOwnerQuestion,
  taskDedupeProjectDirs,
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
  projectDir: string;
  runId: string;
  evidence: ProgressReviewEvidenceIdPacket;
  review: ProgressReviewAgentOutput;
}): ProgressReviewActionResult {
  validateProgressReviewEvidenceIds({ evidence: args.evidence, review: args.review });
  const applied: ProgressReviewAppliedAction[] = [];
  const dedupeProjectDirs = taskDedupeProjectDirs(args.projectDir, args.evidence);
  for (const { group } of progressReviewFindingGroupEntries(args.review)) {
    for (const task of group.followUpTasks) {
      applied.push(writeFollowUpTask({ ...args, dedupeProjectDirs, task }));
    }
  }
  for (const question of args.review.ownerQuestions) {
    applied.push(enqueueOwnerQuestion({ ...args, question }));
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
  return {
    createdTaskIds,
    ownerQuestionIds,
    applied,
    touchedTaskQueue: createdTaskIds.length > 0,
  };
}
