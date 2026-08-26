import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  type MoveTaskResult,
  moveTaskById,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  buildPromotionRationale,
  PROMOTION_BATCH_LIMIT,
  type PromotionRationale,
} from "./promotion.js";

export type BacklogInspection = {
  dirty: boolean;
  rationale: PromotionRationale;
};

export type PromotionMoves = {
  promotions: MoveTaskResult[];
};

export function inspectBacklogInWorker(input: {
  workspaceRoot: string;
}): BacklogInspection {
  const worktree = getRepoWorktreeStatus(input.workspaceRoot);
  const dirty = worktree.available && worktree.dirty;
  const rationale = buildPromotionRationale(input.workspaceRoot, {
    batchLimit: PROMOTION_BATCH_LIMIT,
  });
  return { dirty, rationale };
}

export function applyBacklogPromotionInWorker(input: {
  workspaceRoot: string;
  taskIds: string[];
}): PromotionMoves {
  return {
    promotions: input.taskIds.map((taskId) =>
      moveTaskById(input.workspaceRoot, taskId, "ready"),
    ),
  };
}

export const inspectBacklogOperation = defineWorkflowBlockingOperation<
  { workspaceRoot: string },
  BacklogInspection
>(import.meta.url, "inspectBacklogInWorker");

export const applyBacklogPromotionOperation = defineWorkflowBlockingOperation<
  { workspaceRoot: string; taskIds: string[] },
  PromotionMoves
>(import.meta.url, "applyBacklogPromotionInWorker");
