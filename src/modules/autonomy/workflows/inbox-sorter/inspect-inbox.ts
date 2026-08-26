import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { defineWorkflowBlockingOperation } from "#core/workflow/blocking-operation.js";
import {
  getRepoTaskQueueSnapshot,
  REPO_INBOX_DIR,
} from "#modules/repo-tasks/repo-tasks-domain.js";

export type InboxSorterAssessment = {
  inboxCount: number;
  needsAttention: boolean;
};

type InboxSorterInspectionInput = {
  workspaceRoot: string;
};

export function inspectInboxSorterState(
  input: InboxSorterInspectionInput,
): InboxSorterAssessment {
  const status = getRepoWorktreeStatus(input.workspaceRoot);
  const nonInboxChanges = status.entries.filter(
    (entry) => !entry.includes(REPO_INBOX_DIR),
  );
  if (status.available && nonInboxChanges.length > 0) {
    throw new Error(
      `Repository has changes outside inbox: ${nonInboxChanges.join(", ")}`,
    );
  }
  const queue = getRepoTaskQueueSnapshot(input.workspaceRoot);
  return {
    inboxCount: queue.inboxCount,
    needsAttention: queue.inboxCount > 0,
  };
}

export const inspectInboxSorterStateOperation =
  defineWorkflowBlockingOperation<
    InboxSorterInspectionInput,
    InboxSorterAssessment
  >(import.meta.url, "inspectInboxSorterState");
