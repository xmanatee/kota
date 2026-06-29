import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import builderWorkflow from "./workflow.js";

vi.mock("#core/config/config.js", () => ({
  loadConfig: vi.fn(() => ({ modules: { builder: { branchPerTask: false } } })),
}));

vi.mock("#core/util/repo-worktree.js", () => ({
  getRepoWorktreeStatus: vi.fn(() => ({
    available: true,
    dirty: false,
    trackedDirty: false,
    entries: [],
    fingerprint: "",
    summary: "clean",
    headSha: "abc1234",
  })),
  getRepoHeadSha: vi.fn(() => "abc1234"),
}));

vi.mock("#core/workflow/steps/agent-write-scope.js", () => ({
  findWorkflowScratchArtifactPaths: vi.fn(() => []),
  listWorkflowMutatedPaths: vi.fn(() => ["data/tasks/done/task-claimed.md"]),
}));

vi.mock("#modules/repo-tasks/repo-tasks-domain.js", () => ({
  getRepoTaskQueueSnapshot: vi.fn(),
  isRepoTaskQueueSnapshot: vi.fn(() => true),
  REPO_TASK_STATES: ["backlog", "ready", "doing", "blocked", "done", "dropped"],
  REPO_TASKS_DIR: "data/tasks",
}));

vi.mock("#modules/autonomy/commit.js", () => ({
  commitWorkflowChanges: vi.fn(),
}));

vi.mock("#modules/autonomy/task-claims.js", () => ({
  DEFAULT_TASK_CLAIM_LEASE_MS: 25_200_000,
  taskClaimPath: vi.fn((projectDir: string, taskId: string) =>
    `${projectDir}/.kota/task-claims/active/${taskId}.json`
  ),
  claimNextQueueTask: vi.fn(() => ({
    claimed: true,
    taskId: "task-claimed",
    claim: null,
    recoveryStatus: "agent-running",
    safeToRetry: false,
    recoveryPath: "new-claim",
    reason: null,
    candidateCount: 1,
    skipped: [],
    activeClaims: [],
  })),
  markTaskClaimPendingMerge: vi.fn(() => ({
    taskId: "task-claimed",
    changed: true,
    claim: null,
    recoveryStatus: "pending-merge",
    safeToRetry: false,
    reason: null,
  })),
  releaseTaskClaim: vi.fn(() => ({
    taskId: "task-claimed",
    changed: true,
    claim: null,
    recoveryStatus: "released",
    safeToRetry: true,
    reason: null,
  })),
  updateTaskClaimWorkspace: vi.fn((input: {
    taskId: string;
    runId: string;
    workflowId: string;
    workspaceDir: string;
    branch: string;
    baseCommit: string;
    evidence: string;
  }) => ({
    taskId: input.taskId,
    changed: true,
    claim: {
      schemaVersion: 1,
      taskId: input.taskId,
      taskState: "ready",
      runId: input.runId,
      workflowId: input.workflowId,
      owner: `workflow:${input.workflowId}`,
      workspaceDir: input.workspaceDir,
      branch: input.branch,
      baseCommit: input.baseCommit,
      leaseMs: 25_200_000,
      leaseAcquiredAt: "2026-06-27T00:00:00.000Z",
      leaseExpiresAt: "2026-06-27T07:00:00.000Z",
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:00:01.000Z",
      status: "active",
      evidence: input.evidence,
    },
    recoveryStatus: "agent-running",
    safeToRetry: false,
    reason: null,
  })),
}));

vi.mock("./run-summary.js", () => ({
  findTerminalTaskInChangedFiles: vi.fn(() => ({
    taskId: "task-claimed",
    taskTitle: "Claimed task",
  })),
  writeBuilderRunSummary: vi.fn(() => ({
    runId: "test-run-id",
    workflow: "builder",
    taskId: "task-claimed",
    taskTitle: "Claimed task",
    outcome: "success" as const,
    commitSha: "abc1234",
    commitMessage: "test commit",
    filesChanged: [],
    costUsd: null,
    durationMs: null,
    completedAt: new Date().toISOString(),
  })),
}));

vi.mock("./branch-per-task.js", () => ({
  createTaskBranch: vi.fn(() => ({
    branchPerTask: false,
    branch: null,
    baseBranch: null,
    taskId: null,
  })),
  createPullRequest: vi.fn(() => ({ prUrl: "https://github.com/example/repo/pull/1" })),
  cleanupMergedBranches: vi.fn(() => ({ cleaned: [], warnings: [] })),
}));

function makeSnapshot(ready: number, doing: number, backlog = 4) {
  const counts = {
    backlog,
    ready,
    doing,
    blocked: 0,
    done: 0,
    dropped: 0,
  };
  return {
    counts,
    inboxCount: 0,
    openCount: counts.backlog + counts.ready + counts.doing + counts.blocked,
    pullableCount: counts.backlog + counts.ready + counts.doing,
    actionableCount: ready + doing,
    dependencyBlockedTasks: [],
    headSha: "abc1234",
  };
}

describe("builder workflow workspaceDir", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("commits against workspaceDir when the workflow runs in a separate checkout", async () => {
    const projectDir = join(
      tmpdir(),
      `kota-builder-canonical-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const workspaceDir = join(
      tmpdir(),
      `kota-builder-workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(projectDir, { recursive: true });
    mkdirSync(workspaceDir, { recursive: true });
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot(2, 1));

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    try {
      const harness = new WorkflowTestHarness(builderWorkflow, {
        projectDir,
        workspaceDir,
        trigger: {
          event: "autonomy.queue.available",
          payload: { pullableCount: 3, actionableCount: 3, counts: makeSnapshot(2, 1).counts },
        },
        stepMocks: {
          build: { turns: [], totalCostUsd: 0.05 },
        },
      });

      const result = await harness.run();
      const prepareOutput = result.steps["prepare-worktree"].output as {
        runtimeResources: { agentRunDir: string };
      };

      expect(result.status).toBe("success");
      expect(result.steps.commit.status).toBe("success");
      expect(commitWorkflowChanges).toHaveBeenCalledWith(
        workspaceDir,
        prepareOutput.runtimeResources.agentRunDir,
      );

      const { claimNextQueueTask, releaseTaskClaim } =
        await import("#modules/autonomy/task-claims.js");
      expect(claimNextQueueTask).toHaveBeenCalledWith(
        expect.objectContaining({
          projectDir,
          workspaceDir,
          baseCommit: "abc1234",
        }),
      );
      expect(releaseTaskClaim).toHaveBeenCalledWith(
        expect.objectContaining({
          projectDir,
          taskId: "task-claimed",
          runId: "harness-run-id",
          workflowId: "builder",
        }),
      );
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});
