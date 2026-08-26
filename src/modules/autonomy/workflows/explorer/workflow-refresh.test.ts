import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import { EXPLORER_STATE_KEY, type ExplorerState } from "./explorer-state.js";
import explorerWorkflow, { EXPLORATION_REFRESH_MS } from "./workflow.js";

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
}));

vi.mock("#modules/repo-tasks/repo-tasks-domain.js", () => ({
  countRepoPromotableBacklogTasks: vi.fn(() => 0),
  getRepoTaskQueueSnapshot: vi.fn(),
  isRepoTaskQueueSnapshot: vi.fn(() => true),
  isThinDispatchableQueue: vi.fn((snapshot, promotableBacklogCount) => {
    const backlogCount =
      promotableBacklogCount ?? snapshot.promotableBacklogCount ?? 0;
    const waitingCount =
      snapshot.counts.ready + snapshot.counts.doing + backlogCount;
    return (
      snapshot.inboxCount === 0 &&
      waitingCount <= 2 &&
      waitingCount > 0
    );
  }),
  REPO_TASK_STATES: ["backlog", "ready", "doing", "blocked", "done", "dropped"],
  listFullRepoTasks: vi.fn(() => []),
  getRepoTaskStateDir: vi.fn((projectDir: string, state: string) =>
    `${projectDir}/data/tasks/${state}`,
  ),
}));

function makeSnapshot({
  ready = 0,
  backlog = 0,
  doing = 0,
}: {
  ready?: number;
  backlog?: number;
  doing?: number;
} = {}) {
  const counts = { backlog, ready, doing, blocked: 0, done: 0, dropped: 0 };
  const actionableCount = ready + doing;
  const dispatchableCount = actionableCount + backlog;
  return {
    counts,
    inboxCount: 0,
    openCount: dispatchableCount,
    pullableCount: backlog + ready + doing,
    actionableCount,
    promotableBacklogCount: backlog,
    dispatchableCount,
    hasDispatchableWork: dispatchableCount > 0,
    dependencyBlockedTasks: [],
    headSha: "abc1234",
  };
}

function stateWithLastExplorationAt(lastExplorationAt: string) {
  const state = createTestTransactionalRunState();
  state.compareAndSet(EXPLORER_STATE_KEY, 0, { lastExplorationAt });
  return state;
}

describe("explorer workflow refresh", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "explorer-test-"));
    mkdirSync(join(tempDir, ".kota"), { recursive: true });
  });

  it("runs explore when the queue is empty and refresh is due", async () => {
    const { getRepoTaskQueueSnapshot } = await import(
      "#modules/repo-tasks/repo-tasks-domain.js"
    );
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot());

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.empty", payload: {} },
      stepMocks: {
        explore: { turns: [], totalCostUsd: 0.02 },
      },
      runtimeState: { workflows: {} },
      projectDir: tempDir,
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      explorationRefreshDue: true,
      needsAttention: true,
    });
    expect(result.steps.explore.status).toBe("success");
  });

  it("does not write lastExplorationAt when explore step is skipped", async () => {
    const { getRepoTaskQueueSnapshot } = await import(
      "#modules/repo-tasks/repo-tasks-domain.js"
    );
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot());

    const state = stateWithLastExplorationAt(new Date().toISOString());
    const before = state.read<ExplorerState>(EXPLORER_STATE_KEY);

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.empty", payload: {} },
      runtimeState: { workflows: {} },
      projectDir: tempDir,
      contextOverrides: { state },
    });
    await harness.run();

    expect(state.read<ExplorerState>(EXPLORER_STATE_KEY)).toEqual(before);
  });

  it("skips explore when worktree is dirty", async () => {
    const { getRepoWorktreeStatus } = await import("#core/util/repo-worktree.js");
    vi.mocked(getRepoWorktreeStatus).mockReturnValueOnce({
      available: true,
      dirty: true,
      trackedDirty: true,
      entries: ["M src/foo.ts"],
      fingerprint: "M src/foo.ts",
      summary: "src/foo.ts",
      headSha: "abc1234",
    });

    const { getRepoTaskQueueSnapshot } = await import(
      "#modules/repo-tasks/repo-tasks-domain.js"
    );
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot());

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.empty", payload: {} },
      runtimeState: { workflows: {} },
      projectDir: tempDir,
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      dirty: true,
      needsAttention: false,
    });
    expect(result.steps.explore.status).toBe("skipped");
  });

  it("trigger cooldowns match the exploration refresh window to prevent no-op churn", () => {
    for (const trigger of explorerWorkflow.triggers) {
      expect(trigger.cooldownMs).toBe(EXPLORATION_REFRESH_MS);
    }
  });

  it("does not starve exploration when skipped runs repeatedly complete", async () => {
    const { getRepoTaskQueueSnapshot } = await import(
      "#modules/repo-tasks/repo-tasks-domain.js"
    );
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot());

    const thirtyFiveMinutesAgo = new Date(
      Date.now() - 35 * 60 * 1000,
    ).toISOString();
    const state = stateWithLastExplorationAt(thirtyFiveMinutesAgo);

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.empty", payload: {} },
      runtimeState: {
        workflows: {
          explorer: {
            lastCompletion: {
              runId: "run-explorer-skipped",
              startedAt: new Date(
                Date.now() - 2 * 60 * 1000 - 10_000,
              ).toISOString(),
              completedAt: new Date(
                Date.now() - 2 * 60 * 1000,
              ).toISOString(),
              status: "success",
            },
          },
        },
      },
      stepMocks: { explore: { turns: [], totalCostUsd: 0.02 } },
      projectDir: tempDir,
      contextOverrides: { state },
    });

    const result = await harness.run();

    expect(result.steps["inspect-queue"].output).toMatchObject({
      explorationRefreshDue: true,
      needsAttention: true,
    });
    expect(result.steps.explore.status).toBe("success");
  });
});
