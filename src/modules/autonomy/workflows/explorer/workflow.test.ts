import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "../../../../workflow-testing/index.js";
import explorerWorkflow from "./workflow.js";

vi.mock("../../../../repo-worktree.js", () => ({
  assertRepoWorktreeClean: vi.fn(),
  getRepoWorktreeStatus: vi.fn(() => ({
    available: true,
    dirty: false,
    entries: [],
  })),
}));

vi.mock("../../../repo-tasks/repo-tasks.js", () => ({
  getRepoTaskQueueSnapshot: vi.fn(),
  isRepoTaskQueueSnapshot: vi.fn(() => true),
  REPO_TASK_STATES: ["backlog", "ready", "doing", "blocked", "done", "dropped"],
}));

vi.mock("../../commit.js", () => ({
  commitWorkflowChanges: vi.fn(),
}));

vi.mock("../../../repo-tasks/task-queue-validation.js", () => ({
  assertArchitectureReadyCoverage: vi.fn(),
}));

function makeSnapshot({
  inboxCount = 0,
  ready = 0,
  backlog = 0,
  doing = 0,
  blocked = 0,
  done = 0,
  dropped = 0,
} = {}) {
  const counts = { backlog, ready, doing, blocked, done, dropped };
  return {
    counts,
    inboxCount,
    openCount: inboxCount + backlog + ready + doing + blocked,
    pullableCount: backlog + ready + doing,
    actionableCount: ready + doing,
    headSha: "abc1234",
  };
}

function recentTimestamp(): string {
  return new Date(Date.now() - 5 * 60 * 1000).toISOString();
}

describe("explorer workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips explore when inbox is non-empty", async () => {
    const { getRepoTaskQueueSnapshot } = await import("../../../repo-tasks/repo-tasks.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(
      makeSnapshot({ inboxCount: 1, ready: 0, backlog: 0 }),
    );

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.empty", payload: {} },
      runtimeState: { workflows: {} },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      inboxCount: 1,
      needsAttention: false,
    });
    expect(result.steps.explore.status).toBe("skipped");
  });

  it("skips explore when ready or backlog already contains work", async () => {
    const { getRepoTaskQueueSnapshot } = await import("../../../repo-tasks/repo-tasks.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(
      makeSnapshot({ inboxCount: 0, ready: 1, backlog: 2 }),
    );

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.empty", payload: {} },
      runtimeState: { workflows: {} },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      needsAttention: false,
    });
    expect(result.steps.explore.status).toBe("skipped");
  });

  it("skips explore when doing already contains work", async () => {
    const { getRepoTaskQueueSnapshot } = await import("../../../repo-tasks/repo-tasks.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(
      makeSnapshot({ inboxCount: 0, ready: 0, backlog: 0, doing: 1 }),
    );

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.empty", payload: {} },
      runtimeState: { workflows: {} },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      needsAttention: false,
    });
    expect(result.steps.explore.status).toBe("skipped");
  });

  it("skips explore when the queue is empty but the refresh window is not due", async () => {
    const { getRepoTaskQueueSnapshot } = await import("../../../repo-tasks/repo-tasks.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot());

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.empty", payload: {} },
      runtimeState: {
        workflows: {
          explorer: { lastCompletedAt: recentTimestamp() },
        },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      explorationRefreshDue: false,
      needsAttention: false,
    });
    expect(result.steps.explore.status).toBe("skipped");
  });

  it("runs explore when the queue is empty and refresh is due", async () => {
    const { getRepoTaskQueueSnapshot } = await import("../../../repo-tasks/repo-tasks.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot());

    const { commitWorkflowChanges } = await import("../../commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "autonomy.queue.empty", payload: {} },
      stepMocks: {
        explore: { turns: [], totalCostUsd: 0.02 },
      },
      runtimeState: { workflows: {} },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      explorationRefreshDue: true,
      needsAttention: true,
    });
    expect(result.steps.explore.status).toBe("success");
    expect(result.steps.commit.status).toBe("success");
  });
});
