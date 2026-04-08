import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "../../workflow-testing/index.js";
import builderWorkflow from "./workflow.js";

const promptPath = fileURLToPath(new URL("./prompt.md", import.meta.url));
const promptContent = readFileSync(promptPath, "utf-8");

vi.mock("../../repo-worktree.js", () => ({
  assertRepoWorktreeClean: vi.fn(),
  getRepoWorktreeStatus: vi.fn(() => ({
    available: true,
    dirty: false,
    entries: [],
  })),
  getRepoHeadSha: vi.fn(() => "abc1234"),
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

vi.mock("./run-summary.js", () => ({
  writeBuilderRunSummary: vi.fn(() => ({
    runs: [],
    costByWorkflow: {},
  })),
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
    headSha: "abc1234",
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
    headSha: "abc1234",
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
    expect(result.steps["check-no-intermediate-commits"].status).toBe("skipped");
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
    expect(result.steps["check-no-intermediate-commits"].status).toBe("success");
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

  it("fails when builder agent committed directly (intermediate commit detected)", async () => {
    const { getRepoTaskQueueSnapshot } = await import("../../repo-tasks.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot(1, 0));

    const { getRepoHeadSha } = await import("../../repo-worktree.js");
    // Snapshot captured "abc1234" at start; agent then committed, changing HEAD
    vi.mocked(getRepoHeadSha).mockReturnValue("def5678");

    const harness = new WorkflowTestHarness(builderWorkflow, {
      trigger: {
        event: "workflow.completed",
        payload: { workflow: "explorer", status: "success" },
      },
      stepMocks: {
        build: { turns: [], totalCostUsd: 0.1 },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("failed");
    expect(result.steps.build.status).toBe("success");
    expect(result.steps["check-no-intermediate-commits"].status).toBe("failed");
    expect(result.steps["check-no-intermediate-commits"].error).toMatch(/committed directly/);
    expect(result.steps.commit).toBeUndefined();
  });

  it("prompt instructs agent to scan blocked/ and doing/ before selecting a task", () => {
    expect(promptContent).toMatch(/tasks\/blocked\//);
    expect(promptContent).toMatch(/tasks\/doing\//);
    expect(promptContent).toMatch(/skip/i);
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
