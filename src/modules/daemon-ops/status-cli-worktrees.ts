import type { AutomationWorktreeOperatorStatus } from "#modules/git/worktree-lifecycle.js";
import {
  group,
  type KVEntry,
  kvBlock,
  list,
  plain,
  type RenderNode,
  type SemanticRole,
  span,
} from "#modules/rendering/primitives.js";

function cleanupValue(worktree: AutomationWorktreeOperatorStatus): string {
  if (worktree.cleanupStatus === "removed") return "removed";
  if (worktree.cleanupEligible) return "eligible";
  return `blocked: ${worktree.cleanupBlockers.join("; ") || "unknown reason"}`;
}

function worktreeRole(worktree: AutomationWorktreeOperatorStatus): SemanticRole {
  if (worktree.state === "conflicted") return "error";
  if (worktree.cleanupStatus === "blocked" || worktree.state === "pending-merge" || worktree.state === "stale") return "warn";
  if (worktree.cleanupStatus === "eligible" || worktree.state === "merged") return "success";
  return worktree.state === "removed" ? "muted" : "info";
}

function runtimeResourceValue(worktree: AutomationWorktreeOperatorStatus): string | null {
  const resources = worktree.runtimeResources;
  if (resources === undefined) return null;
  const parts = [`profile ${resources.profileId}`];
  if (resources.ports !== undefined) {
    parts.push(`ports ${resources.ports.start}-${resources.ports.end}`);
  }
  if (resources.tempRoot !== undefined) {
    parts.push(`temp ${resources.tempRoot}`);
  }
  if (resources.artifactRoot !== undefined) {
    parts.push(`artifacts ${resources.artifactRoot}`);
  }
  return parts.join(", ");
}

function worktreeStatusEntries(worktree: AutomationWorktreeOperatorStatus): KVEntry[] {
  const runtimeResources = runtimeResourceValue(worktree);
  return [
    { label: "Owner", value: worktree.owner, role: "muted" },
    { label: "Branch", value: worktree.branch, role: "muted" },
    {
      label: "Commits",
      value: `base ${worktree.baseCommit.slice(0, 8) || "unknown"}, head ${worktree.headCommit.slice(0, 8) || "unknown"}`,
      role: "muted",
    },
    {
      label: "Run",
      value: worktree.runState,
      role: worktree.runState === "active" ? "info" : worktree.state === "stale" ? "warn" : "muted",
    },
    {
      label: "Dirty",
      value: worktree.dirtyState,
      role: worktree.dirtyState === "conflicted" ? "error" : worktree.dirtyState === "dirty" ? "warn" : "muted",
    },
    {
      label: "Merge",
      value: worktree.mergeStatus,
      role: worktree.state === "conflicted" ? "error" : worktree.state === "pending-merge" ? "warn" : "muted",
    },
    {
      label: "Cleanup",
      value: cleanupValue(worktree),
      role: worktree.cleanupStatus === "blocked" ? "warn" : worktree.cleanupStatus === "eligible" ? "success" : "muted",
    },
    ...(runtimeResources !== null
      ? [{ label: "Runtime resources", value: runtimeResources, role: "info" as const }]
      : []),
    { label: "Workspace", value: worktree.workspaceDir, role: worktree.exists ? "muted" : "warn" },
    { label: "Metadata", value: worktree.metadataPath, role: "muted" },
    { label: "Next", value: worktree.nextAction, role: worktreeRole(worktree) },
  ];
}

export function buildWorktreeStatusNode(
  worktrees: readonly AutomationWorktreeOperatorStatus[],
): RenderNode | null {
  if (worktrees.length === 0) return null;
  return group(
    "Automation worktrees",
    list(
      worktrees.map((worktree) => ({
        spans: [
          span(worktree.state, worktreeRole(worktree), true),
          plain(`  ${worktree.taskId}  ${worktree.runId}`),
        ],
        children: [
          kvBlock(worktreeStatusEntries(worktree)),
        ],
      })),
    ),
  );
}
