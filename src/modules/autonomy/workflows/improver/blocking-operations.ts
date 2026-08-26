import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";

export type ImproverWorktreeInspection = {
  dirty: boolean;
  summary: string;
};

export function inspectImproverWorktreeInWorker(input: {
  projectDir: string;
}): ImproverWorktreeInspection {
  const worktree = getRepoWorktreeStatus(input.projectDir);
  return {
    dirty: worktree.available && worktree.dirty,
    summary: worktree.summary,
  };
}

export const inspectImproverWorktreeOperation =
  defineWorkflowBlockingOperation<
    { projectDir: string },
    ImproverWorktreeInspection
  >(import.meta.url, "inspectImproverWorktreeInWorker");
