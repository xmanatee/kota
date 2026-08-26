import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import { createTestTransactionalRunState } from "#core/workflow/testing/run-context-fixture.js";
import { EXPLORER_STATE_KEY } from "./explorer-state.js";
import explorerWorkflow from "./workflow.js";

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
  inboxCount = 0,
  ready = 0,
  backlog = 0,
  doing = 0,
}: {
  inboxCount?: number;
  ready?: number;
  backlog?: number;
  doing?: number;
} = {}) {
  const counts = { backlog, ready, doing, blocked: 0, done: 0, dropped: 0 };
  const actionableCount = ready + doing;
  const dispatchableCount = inboxCount + actionableCount + backlog;
  return {
    counts,
    inboxCount,
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

describe("explorer workflow thin queue gating", () => {
  let tempDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    tempDir = mkdtempSync(join(tmpdir(), "explorer-test-"));
    mkdirSync(join(tempDir, ".kota"), { recursive: true });
  });

  it("runs explore when only a one-item backlog tail remains and refresh is due", async () => {
    const { getRepoTaskQueueSnapshot } = await import(
      "#modules/repo-tasks/repo-tasks-domain.js"
    );
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(
      makeSnapshot({ inboxCount: 0, ready: 0, backlog: 1, doing: 0 }),
    );

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.thin", payload: {} },
      stepMocks: {
        explore: { turns: [], totalCostUsd: 0.02 },
      },
      runtimeState: { workflows: {} },
      projectDir: tempDir,
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      pullableCount: 1,
      actionableCount: 0,
      needsAttention: true,
    });
    expect(result.steps.explore.status).toBe("success");
  });

  it("runs explore when a single ready task remains and refresh is due", async () => {
    const { getRepoTaskQueueSnapshot } = await import(
      "#modules/repo-tasks/repo-tasks-domain.js"
    );
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(
      makeSnapshot({ inboxCount: 0, ready: 1, backlog: 0, doing: 0 }),
    );

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.thin", payload: {} },
      stepMocks: {
        explore: { turns: [], totalCostUsd: 0.02 },
      },
      runtimeState: { workflows: {} },
      projectDir: tempDir,
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      pullableCount: 1,
      actionableCount: 1,
      needsAttention: true,
    });
    expect(result.steps.explore.status).toBe("success");
  });

  it("explores when only active doing work remains", async () => {
    const { getRepoTaskQueueSnapshot } = await import(
      "#modules/repo-tasks/repo-tasks-domain.js"
    );
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(
      makeSnapshot({ inboxCount: 0, ready: 0, backlog: 0, doing: 1 }),
    );

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.thin", payload: {} },
      stepMocks: {
        explore: { turns: [], totalCostUsd: 0.02 },
      },
      runtimeState: { workflows: {} },
      projectDir: tempDir,
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      needsAttention: true,
    });
    expect(result.steps.explore.status).toBe("success");
  });

  it("skips explore when the queue is empty but the refresh window is not due", async () => {
    const { getRepoTaskQueueSnapshot } = await import(
      "#modules/repo-tasks/repo-tasks-domain.js"
    );
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot());
    const state = createTestTransactionalRunState();
    state.compareAndSet(EXPLORER_STATE_KEY, 0, {
      lastExplorationAt: new Date().toISOString(),
    });

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.empty", payload: {} },
      runtimeState: { workflows: {} },
      projectDir: tempDir,
      contextOverrides: { state },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      explorationRefreshDue: false,
      needsAttention: false,
    });
    expect(result.steps.explore.status).toBe("skipped");
  });
});
