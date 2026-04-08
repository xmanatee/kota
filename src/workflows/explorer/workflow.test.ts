import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "../../workflow-testing/index.js";
import explorerWorkflow from "./workflow.js";

vi.mock("../../repo-worktree.js", () => ({
  assertRepoWorktreeClean: vi.fn(),
  getRepoWorktreeStatus: vi.fn(() => ({
    available: true,
    dirty: false,
    entries: [],
  })),
}));

vi.mock("../../repo-tasks.js", () => ({
  getRepoTaskQueueSnapshot: vi.fn(),
  countRepoTasks: vi.fn(() => 0),
  isRepoTaskQueueSnapshot: vi.fn(() => true),
  REPO_TASK_STATES: [
    "inbox",
    "backlog",
    "ready",
    "doing",
    "blocked",
    "done",
    "dropped",
  ],
}));

vi.mock("../commit.js", () => ({
  commitWorkflowChanges: vi.fn(),
}));

vi.mock("../../task-queue-validation.js", () => ({
  assertArchitectureReadyCoverage: vi.fn(),
  assertTaskQueueRecommendations: vi.fn(),
  assertNoHighPriorityBacklogStrandedTasks: vi.fn(),
  hasArchitectureReadyCoverageGap: vi.fn(() => false),
  hasHighPriorityBacklogTasks: vi.fn(() => false),
}));

function makeHealthySnapshot() {
  // ready >= 4, backlog >= 8, inbox = 0 → needsAttention = false (if refresh not due)
  const counts = {
    inbox: 0,
    backlog: 8,
    ready: 4,
    doing: 0,
    blocked: 0,
    done: 0,
    dropped: 0,
  };
  return {
    counts,
    openCount: counts.inbox + counts.backlog + counts.ready + counts.doing + counts.blocked,
    actionableCount: counts.ready + counts.doing,
  };
}

function makeAttentionSnapshot() {
  // ready < 4 → needsAttention = true
  const counts = {
    inbox: 0,
    backlog: 8,
    ready: 1,
    doing: 0,
    blocked: 0,
    done: 0,
    dropped: 0,
  };
  return {
    counts,
    openCount: counts.inbox + counts.backlog + counts.ready + counts.doing + counts.blocked,
    actionableCount: counts.ready + counts.doing,
  };
}

// A recent timestamp (within the 30-minute strategic refresh window)
function recentTimestamp(): string {
  return new Date(Date.now() - 5 * 60 * 1000).toISOString();
}

describe("explorer workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips explore when queue is healthy and strategic refresh is not due", async () => {
    const { getRepoTaskQueueSnapshot } = await import("../../repo-tasks.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeHealthySnapshot());

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "runtime.idle", payload: {} },
      stepMocks: {},
      runtimeState: {
        workflows: {
          explorer: { lastCompletedAt: recentTimestamp() },
        },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].status).toBe("success");
    expect(result.steps.explore.status).toBe("skipped");
    expect(result.steps.commit.status).toBe("skipped");
  });

  it("runs explore when ready task count is below target", async () => {
    const { getRepoTaskQueueSnapshot } = await import("../../repo-tasks.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeAttentionSnapshot());

    const { commitWorkflowChanges } = await import("../commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "runtime.idle", payload: {} },
      stepMocks: {
        explore: { turns: [], totalCostUsd: 0.02 },
      },
      runtimeState: {
        workflows: {
          explorer: { lastCompletedAt: recentTimestamp() },
        },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps.explore.status).toBe("success");
    expect(result.steps.commit.status).toBe("success");
  });

  it("runs explore when strategic refresh is due (no recent completion)", async () => {
    const { getRepoTaskQueueSnapshot } = await import("../../repo-tasks.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeHealthySnapshot());

    const { commitWorkflowChanges } = await import("../commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "runtime.idle", payload: {} },
      stepMocks: {
        explore: { turns: [] },
      },
      runtimeState: {
        workflows: {},
        // no explorer.lastCompletedAt → strategic refresh due
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      strategicRefreshDue: true,
      needsAttention: true,
    });
    expect(result.steps.explore.status).toBe("success");
  });

  it("runs explore when high-priority tasks are stranded in backlog", async () => {
    const { getRepoTaskQueueSnapshot } = await import("../../repo-tasks.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeHealthySnapshot());

    const { hasHighPriorityBacklogTasks } = await import("../../task-queue-validation.js");
    vi.mocked(hasHighPriorityBacklogTasks).mockReturnValue(true);

    const { commitWorkflowChanges } = await import("../commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "runtime.idle", payload: {} },
      stepMocks: {
        explore: { turns: [], totalCostUsd: 0.01 },
      },
      runtimeState: {
        workflows: {
          explorer: { lastCompletedAt: recentTimestamp() },
        },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      hasHighPriorityBacklogTasks: true,
      needsAttention: true,
    });
    expect(result.steps.explore.status).toBe("success");
  });

  it("runs explore when ready queue loses architecture coverage while flat extensions remain", async () => {
    const { getRepoTaskQueueSnapshot } = await import("../../repo-tasks.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeHealthySnapshot());

    const { hasArchitectureReadyCoverageGap } = await import("../../task-queue-validation.js");
    vi.mocked(hasArchitectureReadyCoverageGap).mockReturnValue(true);

    const { commitWorkflowChanges } = await import("../commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "runtime.idle", payload: {} },
      stepMocks: {
        explore: { turns: [], totalCostUsd: 0.01 },
      },
      runtimeState: {
        workflows: {
          explorer: { lastCompletedAt: recentTimestamp() },
        },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-queue"].output).toMatchObject({
      hasArchitectureReadyGap: true,
      needsAttention: true,
    });
    expect(result.steps.explore.status).toBe("success");
  });

  it("skips commit when explore fails", async () => {
    const { getRepoTaskQueueSnapshot } = await import("../../repo-tasks.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeAttentionSnapshot());

    // explore mock missing → harness throws, step fails
    const harness = new WorkflowTestHarness(explorerWorkflow, {
      trigger: { event: "runtime.idle", payload: {} },
      stepMocks: {},
      runtimeState: {
        workflows: { explorer: { lastCompletedAt: recentTimestamp() } },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("failed");
    expect(result.steps.explore.status).toBe("failed");
    expect(result.steps.commit).toBeUndefined();
  });
});
