import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowStepContext } from "#core/workflow/run-types.js";
import type { WorkflowAgentStepInput } from "#core/workflow/step-input-base.js";
import { successfulWorkflowCommandRun } from "#core/workflow/testing/command-runner.js";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import inboxSorterWorkflow from "./workflow.js";

vi.mock("#core/util/repo-worktree.js", () => ({
  getRepoWorktreeStatus: vi.fn().mockReturnValue({
    available: true,
    dirty: false,
    trackedDirty: false,
    entries: [],
    fingerprint: "",
    summary: "clean",
    headSha: "abc1234",
  }),
}));

vi.mock("#core/agent-harness/index.js", async () => {
  const actual = await vi.importActual<typeof import("#core/agent-harness/index.js")>(
    "#core/agent-harness/index.js",
  );
  return {
    ...actual,
    createWorkflowAgentGuards: vi.fn(() => () => ({ allow: true })),
    resolveAgentHarness: vi.fn(() => ({ name: "mock-harness" })),
    routeKotaToolControlOptions: vi.fn(() => ({})),
    runAgentHarness: vi.fn(async () => ({
      text: JSON.stringify({
        decision: "pass",
        summary: "No advisory findings.",
        citedArtifacts: [],
        findings: [],
      }),
      streamedText: "",
      turns: 1,
      isError: false,
      totalCostUsd: 0,
    })),
  };
});

vi.mock("#modules/repo-tasks/repo-tasks-domain.js", () => ({
  getRepoTaskQueueSnapshot: vi.fn(),
  REPO_INBOX_DIR: "data/inbox",
}));

function makeSnapshot(inboxCount: number) {
  return {
    counts: {
      backlog: 0,
      ready: 0,
      doing: 0,
      blocked: 0,
      done: 0,
      dropped: 0,
    },
    inboxCount,
    openCount: inboxCount,
    pullableCount: 0,
    actionableCount: 0,
    promotableBacklogCount: 0,
    dispatchableCount: inboxCount,
    hasDispatchableWork: inboxCount > 0,
    dependencyBlockedTasks: [],
    headSha: "abc1234",
  };
}

describe("inbox-sorter workflow", () => {
  async function mockCleanWorktree() {
    const { getRepoWorktreeStatus } = await import("#core/util/repo-worktree.js");
    vi.mocked(getRepoWorktreeStatus).mockReturnValue({
      available: true,
      dirty: false,
      trackedDirty: false,
      entries: [],
      fingerprint: "",
      summary: "clean",
      headSha: "abc1234",
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips sorting when inbox is empty", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot(0));

    const harness = new WorkflowTestHarness(inboxSorterWorkflow, {
      trigger: { event: "autonomy.inbox.available", payload: {} },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-inbox"].output).toMatchObject({
      inboxCount: 0,
      needsAttention: false,
    });
    expect(result.steps["sort-inbox"].status).toBe("skipped");
  });

  it("runs task validation through the supervised command rail", async () => {
    const sorterStep = inboxSorterWorkflow.steps.find(
      (step): step is WorkflowAgentStepInput =>
        "id" in step && step.id === "sort-inbox" && step.type === "agent",
    );
    const check = sorterStep?.repairLoop?.checks.find(
      (entry) => entry.id === "task-queue-valid",
    );
    if (!check || check.type !== "code") throw new Error("task-queue-valid missing");
    const workspaceRoot = "/tmp/inbox-sorter-command-test";
    const runCommand = vi.fn(successfulWorkflowCommandRun);

    await check.run(
      { workspaceRoot, runCommand } as unknown as WorkflowStepContext,
      {} as never,
    );

    expect(runCommand).toHaveBeenCalledWith({
      command: "pnpm",
      args: ["run", "validate-tasks"],
      cwd: workspaceRoot,
    });
  });

  it("rejects untracked files outside inbox", async () => {
    const { getRepoWorktreeStatus } = await import("#core/util/repo-worktree.js");
    vi.mocked(getRepoWorktreeStatus).mockReturnValue({
      available: true,
      dirty: true,
      trackedDirty: false,
      entries: ["?? .DS_Store", "?? tmp/scratch.txt"],
      fingerprint: "?? .DS_Store\n?? tmp/scratch.txt",
      summary: ".DS_Store, tmp/scratch.txt",
      headSha: "abc1234",
    });
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot(1));

    const harness = new WorkflowTestHarness(inboxSorterWorkflow, {
      trigger: { event: "autonomy.inbox.available", payload: {} },
      stepMocks: {
        "sort-inbox": { turns: [], totalCostUsd: 0.01 },
      },
    });

    const result = await harness.run();
    expect(result.steps["inspect-inbox"].status).toBe("failed");
  });

  it("allows untracked inbox entries", async () => {
    const { getRepoWorktreeStatus } = await import("#core/util/repo-worktree.js");
    vi.mocked(getRepoWorktreeStatus).mockReturnValue({
      available: true,
      dirty: true,
      trackedDirty: false,
      entries: ["?? data/inbox/task-capture.md"],
      fingerprint: "?? data/inbox/task-capture.md",
      summary: "data/inbox/task-capture.md",
      headSha: "abc1234",
    });
    const { getRepoTaskQueueSnapshot } = await import(
      "#modules/repo-tasks/repo-tasks-domain.js"
    );
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot(1));

    const harness = new WorkflowTestHarness(inboxSorterWorkflow, {
      trigger: { event: "autonomy.inbox.available", payload: {} },
      stepMocks: {
        "sort-inbox": { turns: [], totalCostUsd: 0.01 },
      },
    });

    const result = await harness.run();
    expect(result.steps["inspect-inbox"].status).toBe("success");
    expect(result.steps["sort-inbox"].status).toBe("success");
  });

  it("rejects tracked changes outside inbox", async () => {
    const { getRepoWorktreeStatus } = await import("#core/util/repo-worktree.js");
    vi.mocked(getRepoWorktreeStatus).mockReturnValue({
      available: true,
      dirty: true,
      trackedDirty: true,
      entries: [" M src/core/foo.ts"],
      fingerprint: " M src/core/foo.ts",
      summary: "src/core/foo.ts",
      headSha: "abc1234",
    });
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot(1));

    const harness = new WorkflowTestHarness(inboxSorterWorkflow, {
      trigger: { event: "autonomy.inbox.available", payload: {} },
    });

    const result = await harness.run();
    expect(result.steps["inspect-inbox"].status).toBe("failed");
  });

  it("runs sorter when inbox has entries", async () => {
    await mockCleanWorktree();
    const { getRepoTaskQueueSnapshot } = await import("#modules/repo-tasks/repo-tasks-domain.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot(2));

    const harness = new WorkflowTestHarness(inboxSorterWorkflow, {
      trigger: { event: "autonomy.inbox.available", payload: {} },
      stepMocks: {
        "sort-inbox": { turns: [], totalCostUsd: 0.01 },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["sort-inbox"].status).toBe("success");
  });
});
