import { describe, expect, it } from "vitest";
import { buildStatusUiSurface } from "./operator-ui.js";
import type { UiNode } from "./operator-ui-types.js";
import type { StatusSnapshot } from "./status-cli.js";

function isAutomationWorktreesList(node: UiNode): node is Extract<UiNode, { kind: "list" }> {
  return node.kind === "list" && node.title === "Automation worktrees";
}

function status(overrides: Partial<StatusSnapshot> = {}): StatusSnapshot {
  return {
    daemonRunning: false,
    activeRuns: 0,
    queuedRuns: 0,
    workflowPaused: false,
    sessions: 0,
    pendingApprovals: 0,
    projectDir: "/repo",
    projectName: "repo",
    controlFile: { kind: "missing" },
    ...overrides,
  };
}

function worktree(
  overrides: Partial<NonNullable<StatusSnapshot["worktrees"]>[number]> = {},
): NonNullable<StatusSnapshot["worktrees"]>[number] {
  return {
    taskId: "task-ui-worktree",
    runId: "run-ui",
    workflowId: "builder",
    owner: "workflow:builder",
    workspaceDir: "/repo/.worktrees/task-ui-worktree-run-ui",
    metadataPath: "/repo/.kota/worktrees/task-ui-worktree-run-ui.json",
    exists: true,
    branch: "kota/task/task-ui-worktree/run-ui",
    baseCommit: "1111111111111111111111111111111111111111",
    headCommit: "2222222222222222222222222222222222222222",
    state: "conflicted",
    metadataState: "pending-merge",
    dirtyState: "conflicted",
    dirtyEntries: ["UU README.md"],
    mergeStatus: "conflicted",
    cleanupStatus: "blocked",
    cleanupEligible: false,
    cleanupBlockers: ["worktree has conflicted paths"],
    nextAction: "resolve merge conflicts before merge or cleanup",
    ...overrides,
  };
}

describe("Status UI automation worktrees", () => {
  it("renders worktree lifecycle and cleanup blockers as list items", () => {
    const surface = buildStatusUiSurface(status({ worktrees: [worktree()] }));
    const worktrees = surface.nodes.find(isAutomationWorktreesList);

    expect(worktrees?.items[0]).toMatchObject({
      id: "task-ui-worktree:run-ui",
      title: "conflicted: task-ui-worktree",
      role: "error",
    });
    expect(worktrees?.items[0]?.detail).toContain("merge conflicted");
    expect(worktrees?.items[0]?.detail).toContain("cleanup blocked: worktree has conflicted paths");
  });
});
