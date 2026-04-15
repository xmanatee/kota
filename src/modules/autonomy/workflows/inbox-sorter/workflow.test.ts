import { beforeEach, describe, expect, it, vi } from "vitest";
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

vi.mock("#core/data/repo-tasks.js", () => ({
  getRepoTaskQueueSnapshot: vi.fn(),
  REPO_INBOX_DIR: "data/inbox",
}));

vi.mock("#modules/autonomy/commit.js", () => ({
  commitWorkflowChanges: vi.fn(),
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
    headSha: "abc1234",
  };
}

describe("inbox-sorter workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips sorting when inbox is empty", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#core/data/repo-tasks.js");
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
    expect(result.steps.commit.status).toBe("skipped");
  });

  it("runs sorter and commit when inbox has entries", async () => {
    const { getRepoTaskQueueSnapshot } = await import("#core/data/repo-tasks.js");
    vi.mocked(getRepoTaskQueueSnapshot).mockReturnValue(makeSnapshot(2));

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const harness = new WorkflowTestHarness(inboxSorterWorkflow, {
      trigger: { event: "autonomy.inbox.available", payload: {} },
      stepMocks: {
        "sort-inbox": { turns: [], totalCostUsd: 0.01 },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["sort-inbox"].status).toBe("success");
    expect(result.steps.commit.status).toBe("success");
  });
});
