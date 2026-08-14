import {
  getRepoWorktreeStatus,
  type RepoWorktreeStatus,
} from "#core/util/repo-worktree.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";

export function inspectRepoWorktreeInWorker(input: {
  projectDir: string;
}): RepoWorktreeStatus {
  return getRepoWorktreeStatus(input.projectDir);
}

export const repoWorktreeStatusOperation = defineWorkflowBlockingOperation<
  { projectDir: string },
  RepoWorktreeStatus
>(import.meta.url, "inspectRepoWorktreeInWorker");
