import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";

export type ImproverWorktreeInspection = {
  dirty: boolean;
  summary: string;
};

export function inspectImproverWorktreeInWorker(input: {
  workspaceRoot: string;
}): ImproverWorktreeInspection {
  const worktree = getRepoWorktreeStatus(input.workspaceRoot);
  return {
    dirty: worktree.available && worktree.dirty,
    summary: worktree.summary,
  };
}

export const inspectImproverWorktreeOperation =
  defineWorkflowBlockingOperation<
    { workspaceRoot: string },
    ImproverWorktreeInspection
  >(import.meta.url, "inspectImproverWorktreeInWorker");
