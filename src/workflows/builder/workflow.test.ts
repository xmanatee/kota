import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "../../workflow-testing/index.js";
import builderWorkflow from "./workflow.js";

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

vi.mock("./dirty-state-recovery.js", () => ({
  autoResetDirtyWorktree: vi.fn(),
}));

vi.mock("../commit.js", () => ({
  commitWorkflowChanges: vi.fn(),
}));

vi.mock("./run-summary.js", () => ({
  writeBuilderRunSummary: vi.fn(() => ({
    runs: [],
    costByWorkflow: {},
  })),
}));

vi.mock("./scope-guard.js", () => ({
  runScopeGuard: vi.fn(() => ({ blocked: false, taskId: "task-example" })),
}));

function makeEmptySnapshot() {
  return {
    counts: {
      inbox: 0,
      backlog: 0,
      ready: 0,
      doing: 0,
      blocked: 0,
      done: 0,
      dropped: 0,
    },
    openCount: 0,
    actionableCount: 0,
  };
}

function makeSnapshot(ready: number, doing: number) {
  const counts = {
    inbox: 0,
    backlog: 4,
    ready,
    doing,
    blocked: 0,
    done: 0,
    dropped: 0,
  };
  return {
    counts,
    openCount: counts.inbox + counts.backlog + counts.ready + counts.doing + counts.blocked,
    actionableCount: ready + doing,
  };
}

describe("builder workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips build and commit when actionableCount is 0", async () => {
    const { getRepoTaskQueueSnapshot } = await import("../../repo-tasks.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeEmptySnapshot());

    const harness = new WorkflowTestHarness(builderWorkflow, {
      trigger: {
        event: "workflow.completed",
        payload: { workflow: "explorer", status: "success" },
      },
      stepMocks: {
        build: { turns: [], totalCostUsd: 0 },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-ready-queue"].status).toBe("success");
    expect(result.steps.build.status).toBe("skipped");
    expect(result.steps.commit.status).toBe("skipped");
    expect(result.steps["write-run-summary"].status).toBe("skipped");
    expect(result.steps["emit-build-committed"].status).toBe("skipped");
    expect(result.steps["request-restart"].status).toBe("skipped");
  });

  it("runs build and commit when actionableCount is greater than 0", async () => {
    const { getRepoTaskQueueSnapshot } = await import("../../repo-tasks.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot(2, 1));

    const { commitWorkflowChanges } = await import("../commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const harness = new WorkflowTestHarness(builderWorkflow, {
      trigger: {
        event: "workflow.completed",
        payload: { workflow: "explorer", status: "success" },
      },
      stepMocks: {
        build: { turns: [], totalCostUsd: 0.05 },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-ready-queue"].status).toBe("success");
    expect(result.steps.build.status).toBe("success");
    expect(result.steps.build.output).toMatchObject({ totalCostUsd: 0.05 });
    expect(result.steps.commit.status).toBe("success");
  });

  it("skips commit and write-run-summary when build fails", async () => {
    const { getRepoTaskQueueSnapshot } = await import("../../repo-tasks.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot(1, 0));

    const harness = new WorkflowTestHarness(builderWorkflow, {
      trigger: {
        event: "workflow.completed",
        payload: { workflow: "explorer", status: "success" },
      },
      // build step mock missing — harness will throw for agent step
    });

    const result = await harness.run();

    expect(result.status).toBe("failed");
    expect(result.steps.build.status).toBe("failed");
    expect(result.steps.build.error).toMatch(/requires a mock/);
    expect(result.steps.commit).toBeUndefined();
  });

  it("emits workflow.build.committed after a successful commit with run-summary payload", async () => {
    const { getRepoTaskQueueSnapshot } = await import("../../repo-tasks.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot(1, 0));

    const { commitWorkflowChanges } = await import("../commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const { writeBuilderRunSummary } = await import("./run-summary.js");
    vi.mocked(writeBuilderRunSummary).mockReturnValue({
      runId: "run-abc",
      workflow: "builder",
      taskId: "task-foo-bar",
      taskTitle: "Add foo bar support",
      outcome: "success",
      commitSha: "abc123",
      commitMessage: "Add foo bar support",
      filesChanged: ["src/foo.ts"],
      costUsd: 0.42,
      durationMs: 480000,
      completedAt: "2026-04-02T10:00:00Z",
    });

    const harness = new WorkflowTestHarness(builderWorkflow, {
      trigger: {
        event: "workflow.completed",
        payload: { workflow: "explorer", status: "success" },
      },
      stepMocks: {
        build: { turns: [], totalCostUsd: 0.42 },
      },
    });

    const result = await harness.run();

    expect(result.steps["emit-build-committed"].status).toBe("success");
    const committed = result.emitted.find((e) => e.event === "workflow.build.committed");
    expect(committed).toBeDefined();
    expect(committed?.payload).toMatchObject({
      taskId: "task-foo-bar",
      commitMessage: "Add foo bar support",
      costUsd: 0.42,
      durationMs: 480000,
    });
  });

  it("skips build and commits scope-block when scope guard blocks a task", async () => {
    const { getRepoTaskQueueSnapshot } = await import("../../repo-tasks.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot(1, 0));

    const { runScopeGuard } = await import("./scope-guard.js");
    vi.mocked(runScopeGuard).mockReturnValue({
      blocked: true,
      taskId: "task-oversized",
      taskFile: "task-oversized.md",
      fromDir: "ready",
      reason: "task-oversized exceeds execution budget (750 body words). Split into smaller tasks.",
      wordCount: 750,
      doneWhenItems: 2,
    });

    const { commitWorkflowChanges } = await import("../commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const harness = new WorkflowTestHarness(builderWorkflow, {
      trigger: {
        event: "workflow.completed",
        payload: { workflow: "explorer", status: "success" },
      },
      stepMocks: {
        build: { turns: [], totalCostUsd: 0 },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["scope-guard"].status).toBe("success");
    expect(result.steps["scope-guard"].output).toMatchObject({ blocked: true, taskId: "task-oversized" });
    expect(result.steps.build.status).toBe("skipped");
    expect(result.steps["commit-scope-block"].status).toBe("success");
    expect(result.steps.commit.status).toBe("skipped");
  });

  it("includes inspect-ready-queue snapshot in step output", async () => {
    const { getRepoTaskQueueSnapshot } = await import("../../repo-tasks.js");
    const snapshot = makeSnapshot(3, 0);
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(snapshot);

    const harness = new WorkflowTestHarness(builderWorkflow, {
      trigger: { event: "workflow.completed", payload: {} },
      stepMocks: { build: { turns: [] } },
    });

    const result = await harness.run();

    expect(result.steps["inspect-ready-queue"].status).toBe("success");
    expect(result.steps["inspect-ready-queue"].output).toMatchObject({
      actionableCount: 3,
      counts: expect.objectContaining({ ready: 3 }),
    });
  });
});
