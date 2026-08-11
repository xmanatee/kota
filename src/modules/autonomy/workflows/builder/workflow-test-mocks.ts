import { vi } from "vitest";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import "./builder-harness-preflight-test-mock.js";
import "./workflow-agent-run-artifacts-test-mock.js";
import "./workflow-worktree-test-mocks.js";

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
  diffMutatedPaths: vi.fn((pre: readonly string[], post: readonly string[]) => {
    const preSet = new Set(pre);
    return post.filter((path) => !preSet.has(path)).sort();
  }),
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

vi.mock("./preserved-evidence.js", () => ({
  findPreservedBuilderEvidenceRunId: vi.fn(() => null),
}));

vi.mock("#modules/autonomy/task-claims.js", () => ({
  DEFAULT_TASK_CLAIM_LEASE_MS: 25_200_000,
  taskClaimPath: vi.fn((projectDir: string, taskId: string) =>
    `${projectDir}/.kota/task-claims/active/${taskId}.json`
  ),
  claimNextQueueTask: vi.fn(() => ({
    claimed: true,
    taskId: "task-claimed",
    claim: {
      schemaVersion: 1,
      taskId: "task-claimed",
      taskState: "ready",
      runId: "harness-run-id",
      workflowId: "builder",
      owner: "workflow:builder",
      workspaceDir: "/tmp/project",
      branch: "main",
      baseCommit: "abc1234",
      leaseMs: 25_200_000,
      leaseAcquiredAt: "2026-06-27T00:00:00.000Z",
      leaseExpiresAt: "2026-06-27T07:00:00.000Z",
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:00:00.000Z",
      status: "active",
      evidence: null,
    },
    recoveryStatus: "agent-running",
    safeToRetry: false,
    recoveryPath: "new-claim",
    reason: null,
    candidateCount: 1,
    skipped: [],
    activeClaims: [],
  })),
  continueTaskClaim: vi.fn((input: {
    taskId: string;
    runId: string;
    workflowId: string;
    owner: string;
  }) => ({
    claimed: true,
    taskId: input.taskId,
    claim: {
      schemaVersion: 1,
      taskId: input.taskId,
      taskState: "ready",
      runId: input.runId,
      worktreeRunId: "run-failed",
      workflowId: input.workflowId,
      owner: input.owner,
      workspaceDir: "/tmp/preserved-builder",
      branch: "kota/task/task-claimed/run-failed",
      baseCommit: "abc1234",
      leaseMs: 25_200_000,
      leaseAcquiredAt: "2026-06-27T00:00:00.000Z",
      leaseExpiresAt: "2026-06-27T07:00:00.000Z",
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:00:01.000Z",
      status: "active",
      evidence: "continued preserved builder work",
    },
    recoveryStatus: "agent-running",
    safeToRetry: false,
    recoveryPath: "continued-preserved-claim",
    reason: null,
  })),
  listTaskClaimInspections: vi.fn(() => []),
  markTaskClaimPendingDecomposition: vi.fn(() => ({
    taskId: "task-claimed",
    changed: true,
    claim: null,
    recoveryStatus: "pending-decomposition",
    safeToRetry: false,
    reason: null,
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
    projectDir: string;
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

vi.mock("#modules/autonomy/workflow-state-recovery-claims.js", () => ({
  findRecoveryClaim: vi.fn(() => null),
  listRecoveryClaims: vi.fn(() => []),
}));

vi.mock("#modules/git/worktree-merge-gate.js", () => ({
  mergeAutomationWorktree: vi.fn((input: {
    projectDir: string;
    taskId: string;
    runId: string;
  }) => ({
    status: "merged",
    taskId: input.taskId,
    runId: input.runId,
    branch: `kota/task/${input.taskId}/${input.runId}`,
    baseCommit: "abc1234",
    canonicalHeadCommit: "abc1234",
    headCommit: "def5678",
    mergeCommit: "def5678",
    reason: null,
    conflicts: [],
    resolutionAttempts: 0,
    validation: {
      command: ["pnpm", "test", "src/modules/git", "src/modules/autonomy/workflows/builder"],
      exitCode: 0,
      stdoutTail: "",
      stderrTail: "",
      passed: true,
    },
    metrics: {
      waitMs: 12,
      mergeDurationMs: 34,
      conflictCount: 0,
      resolverAttempts: 0,
      validationFailures: 0,
      serializedByLock: true,
    },
    artifactPath: `${input.projectDir}/.kota/worktrees/${input.taskId}-${input.runId}.merge-gate.json`,
  })),
}));

vi.mock("./run-summary.js", () => ({
  findTerminalTaskInChangedFiles: vi.fn(() => ({
    taskId: "task-claimed",
    taskTitle: "Claimed task",
  })),
  findTerminalTasksInChangedFiles: vi.fn(() => [
    {
      file: "data/tasks/done/task-claimed.md",
      taskId: "task-claimed",
      taskTitle: "Claimed task",
      becameTerminal: true,
    },
  ]),
  writeBuilderRunSummary: vi.fn(() => ({
    runId: "test-run-id",
    workflow: "builder",
    taskId: null,
    taskTitle: null,
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
  createTaskBranch: vi.fn((ctx: WorkflowStepContext) => {
    const payload = ctx.trigger.payload;
    if (payload.branchPerTask === true) {
      return {
        branchPerTask: true,
        branch: "kota/task/task-foo",
        baseBranch: "main",
        taskId: "task-foo",
      };
    }
    return {
      branchPerTask: false,
      branch: null,
      baseBranch: null,
      taskId: null,
    };
  }),
  createPullRequest: vi.fn((ctx: WorkflowStepContext) => {
    const payload = ctx.trigger.payload;
    if (payload.prError === true) {
      throw new Error("gh CLI is not available or not authenticated.");
    }
    return { prUrl: String(payload.prUrl ?? "https://github.com/example/repo/pull/1") };
  }),
  cleanupMergedBranches: vi.fn((ctx: WorkflowStepContext) => {
    const payload = ctx.trigger.payload;
    return {
      cleaned: Array.isArray(payload.cleanedBranches) ? payload.cleanedBranches : [],
      warnings: Array.isArray(payload.cleanupWarnings) ? payload.cleanupWarnings : [],
    };
  }),
}));

vi.mock("#modules/autonomy/recovery.js", async () => {
  const actual =
    await vi.importActual<typeof import("#modules/autonomy/recovery.js")>(
      "#modules/autonomy/recovery.js",
    );
  return {
    ...actual,
    resetWorktreeForRecovery: vi.fn(() => ({
      stashed: false,
      stashSummary: "clean",
      branchRestored: false,
      previousBranch: null,
      currentBranch: "main",
    })),
  };
});
