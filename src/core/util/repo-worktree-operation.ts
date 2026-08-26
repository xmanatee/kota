import {
  getRepoWorktreeStatus,
  type RepoWorktreeStatus,
} from "#core/util/repo-worktree.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";

export function inspectRepoWorktreeInWorker(input: {
  workspaceRoot: string;
}): RepoWorktreeStatus {
  return getRepoWorktreeStatus(input.workspaceRoot);
}

export const repoWorktreeStatusOperation = defineWorkflowBlockingOperation<
  { workspaceRoot: string },
  RepoWorktreeStatus
>(import.meta.url, "inspectRepoWorktreeInWorker");
