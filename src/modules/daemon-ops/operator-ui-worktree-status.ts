import type { AutomationWorktreeOperatorStatus } from "#modules/git/worktree-lifecycle.js";
import type { UiListItem, UiRole } from "./operator-ui-types.js";
import type { StatusSnapshot } from "./status-cli.js";

function worktreeRole(worktree: AutomationWorktreeOperatorStatus): UiRole {
  if (worktree.state === "conflicted") return "error";
  if (worktree.cleanupStatus === "blocked" || worktree.state === "pending-merge") return "warn";
  if (worktree.cleanupStatus === "eligible" || worktree.state === "merged") return "success";
  return "muted";
}

function worktreeDetail(worktree: AutomationWorktreeOperatorStatus): string {
  const cleanup = worktree.cleanupEligible
    ? "cleanup eligible"
    : worktree.cleanupStatus === "removed"
      ? "cleanup removed"
      : `cleanup blocked: ${worktree.cleanupBlockers.join("; ") || "unknown reason"}`;
  return [
    `run ${worktree.runId}`,
    `branch ${worktree.branch}`,
    `dirty ${worktree.dirtyState}`,
    `merge ${worktree.mergeStatus}`,
    cleanup,
    `next ${worktree.nextAction}`,
  ].join(" · ");
}

export function statusWorktreeItems(snapshot: StatusSnapshot): UiListItem[] {
  return (snapshot.worktrees ?? []).map((worktree) => ({
    id: `${worktree.taskId}:${worktree.runId}`,
    title: `${worktree.state}: ${worktree.taskId}`,
    detail: worktreeDetail(worktree),
    role: worktreeRole(worktree),
  }));
}
