import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import type { RepoTaskQueueSnapshot } from "#modules/repo-tasks/repo-tasks-domain.js";

type WorktreeStatus = {
  available: boolean;
  dirty: boolean;
  trackedDirty: boolean;
  entries: string[];
  fingerprint: string;
  summary: string;
  headSha: string;
};

const queueSnapshots = new Map<string, RepoTaskQueueSnapshot>();
const worktreeStatuses = new Map<string, WorktreeStatus>();

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
  listTaskClaimInspections: vi.fn(() => []),
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
}));

vi.mock("./run-summary.js", () => ({
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

export function makeEmptySnapshot(): RepoTaskQueueSnapshot {
  return {
    counts: {
      backlog: 0,
      ready: 0,
      doing: 0,
      blocked: 0,
      done: 0,
      dropped: 0,
    },
    inboxCount: 0,
    openCount: 0,
    pullableCount: 0,
    actionableCount: 0,
    dependencyBlockedTasks: [],
    headSha: "abc1234",
  };
}

export function makeSnapshot(ready: number, doing: number, backlog = 4): RepoTaskQueueSnapshot {
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

export function makeWorkflowProject(
  snapshot: RepoTaskQueueSnapshot,
  worktreeStatus?: WorktreeStatus,
): string {
  const projectDir = join(tmpdir(), `kota-builder-workflow-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  queueSnapshots.set(projectDir, snapshot);
  if (worktreeStatus) worktreeStatuses.set(projectDir, worktreeStatus);
  return projectDir;
}

export async function resetBuilderWorkflowMocks(): Promise<void> {
  vi.clearAllMocks();

  const worktree = await import("#core/util/repo-worktree.js");
  vi.mocked(worktree.getRepoWorktreeStatus).mockImplementation((repoDir) =>
    worktreeStatuses.get(repoDir) ?? {
      available: true,
      dirty: false,
      trackedDirty: false,
      entries: [],
      fingerprint: "",
      summary: "clean",
      headSha: "abc1234",
    },
  );
  vi.mocked(worktree.getRepoHeadSha).mockReturnValue("abc1234");

  const repoTasks = await import("#modules/repo-tasks/repo-tasks-domain.js");
  vi.mocked(repoTasks.getRepoTaskQueueSnapshot).mockImplementation((projectDir) =>
    queueSnapshots.get(projectDir) ?? makeEmptySnapshot(),
  );

  const claims = await import("#modules/autonomy/task-claims.js");
  vi.mocked(claims.claimNextQueueTask).mockReturnValue({
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
  });
  vi.mocked(claims.listTaskClaimInspections).mockReturnValue([]);
  vi.mocked(claims.markTaskClaimPendingMerge).mockReturnValue({
    taskId: "task-claimed",
    changed: true,
    claim: null,
    recoveryStatus: "pending-merge",
    safeToRetry: false,
    reason: null,
  });
  vi.mocked(claims.releaseTaskClaim).mockReturnValue({
    taskId: "task-claimed",
    changed: true,
    claim: null,
    recoveryStatus: "released",
    safeToRetry: true,
    reason: null,
  });

  const branch = await import("./branch-per-task.js");
  vi.mocked(branch.createTaskBranch).mockImplementation((ctx) => {
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
  });
  vi.mocked(branch.createPullRequest).mockImplementation((ctx) => {
    const payload = ctx.trigger.payload;
    if (payload.prError === true) {
      throw new Error("gh CLI is not available or not authenticated.");
    }
    return { prUrl: String(payload.prUrl ?? "https://github.com/example/repo/pull/1") };
  });
  vi.mocked(branch.cleanupMergedBranches).mockImplementation((ctx) => {
    const payload = ctx.trigger.payload;
    return {
      cleaned: Array.isArray(payload.cleanedBranches) ? payload.cleanedBranches : [],
      warnings: Array.isArray(payload.cleanupWarnings) ? payload.cleanupWarnings : [],
    };
  });

  const runSummary = await import("./run-summary.js");
  vi.mocked(runSummary.writeBuilderRunSummary).mockReturnValue({
    runId: "test-run-id",
    workflow: "builder",
    taskId: null,
    taskTitle: null,
    outcome: "success",
    commitSha: "abc1234",
    commitMessage: "test commit",
    filesChanged: [],
    costUsd: null,
    durationMs: null,
    completedAt: new Date().toISOString(),
  });
}
