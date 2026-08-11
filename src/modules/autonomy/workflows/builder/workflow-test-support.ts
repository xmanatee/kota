import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, vi } from "vitest";
import { getPreset, resolveTierModel } from "#core/model/preset.js";
import type { RepoTaskQueueSnapshot } from "#modules/repo-tasks/repo-tasks-domain.js";
import { setBuilderPortAvailabilityCheckerForTest } from "./runtime-resource-ports.js";
import "./workflow-test-mocks.js";

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
let restoreBuilderPortAvailability = () => {};

afterAll(() => {
  restoreBuilderPortAvailability();
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
    promotableBacklogCount: 0,
    dispatchableCount: 0,
    hasDispatchableWork: false,
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
  const actionableCount = ready + doing;
  const promotableBacklogCount = backlog;
  const dispatchableCount = actionableCount + promotableBacklogCount;
  return {
    counts,
    inboxCount: 0,
    openCount: counts.backlog + counts.ready + counts.doing + counts.blocked,
    pullableCount: counts.backlog + counts.ready + counts.doing,
    actionableCount,
    promotableBacklogCount,
    dispatchableCount,
    hasDispatchableWork: dispatchableCount > 0,
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
  restoreBuilderPortAvailability();
  restoreBuilderPortAvailability = setBuilderPortAvailabilityCheckerForTest(async () => true);

  const harnessPreflight = await import("./builder-harness-preflight.js");
  vi.mocked(harnessPreflight.runBuilderHarnessPreflight).mockReturnValue({
    harness: "codex",
    model: resolveTierModel(getPreset("codex"), "capable"),
    effort: "xhigh",
    ready: true,
    artifactPath:
      ".kota/runs/harness/steps/builder-preclaim.harness-capability.json",
  });

  const config = await import("#core/config/config.js");
  vi.mocked(config.loadConfig).mockReturnValue({
    modules: { builder: { branchPerTask: false } },
  });

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

  const agentWriteScope = await import("#core/workflow/steps/agent-write-scope.js");
  vi.mocked(agentWriteScope.diffMutatedPaths).mockImplementation((pre, post) => {
    const preSet = new Set(pre);
    return post.filter((path) => !preSet.has(path)).sort();
  });
  vi.mocked(agentWriteScope.listWorkflowMutatedPaths).mockReturnValue([
    "data/tasks/done/task-claimed.md",
  ]);

  const repoTasks = await import("#modules/repo-tasks/repo-tasks-domain.js");
  vi.mocked(repoTasks.getRepoTaskQueueSnapshot).mockImplementation((projectDir) =>
    queueSnapshots.get(projectDir) ?? makeEmptySnapshot(),
  );

  const claims = await import("#modules/autonomy/task-claims.js");
  vi.mocked(claims.claimNextQueueTask).mockReturnValue({
    claimed: true,
    taskId: "task-claimed",
    claim: {
      schemaVersion: 2,
      taskId: "task-claimed",
      taskState: "ready",
      taskFile: {
        path: "data/tasks/ready/task-claimed.md",
        snapshot: { dev: 1, ino: 1, size: 1, mtimeMs: 1, ctimeMs: 1 },
      },
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
  vi.mocked(claims.updateTaskClaimWorkspace).mockImplementation((input) => ({
    taskId: input.taskId,
    changed: true,
    claim: {
      schemaVersion: 2,
      taskId: input.taskId,
      taskState: "ready",
      taskFile: {
        path: `data/tasks/ready/${input.taskId}.md`,
        snapshot: { dev: 1, ino: 1, size: 1, mtimeMs: 1, ctimeMs: 1 },
      },
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
  }));

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
  vi.mocked(runSummary.findTerminalTaskInChangedFiles).mockReturnValue({
    taskId: "task-claimed",
    taskTitle: "Claimed task",
  });
  vi.mocked(runSummary.findTerminalTasksInChangedFiles).mockReturnValue([
    {
      file: "data/tasks/done/task-claimed.md",
      taskId: "task-claimed",
      taskTitle: "Claimed task",
      becameTerminal: true,
    },
  ]);
  vi.mocked(runSummary.writeBuilderRunSummary).mockReturnValue({
    runId: "test-run-id",
    workflow: "builder",
    taskId: "task-claimed",
    taskTitle: "Claimed task",
    outcome: "success",
    commitSha: "abc1234",
    commitMessage: "test commit",
    filesChanged: [],
    costUsd: null,
    durationMs: null,
    completedAt: new Date().toISOString(),
  });
}
