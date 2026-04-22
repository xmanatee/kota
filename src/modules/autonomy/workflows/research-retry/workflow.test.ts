import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import researchRetryWorkflow from "./workflow.js";

vi.mock("#core/util/repo-worktree.js", () => ({
  getRepoWorktreeStatus: vi.fn(),
}));

vi.mock("./candidates.js", () => ({
  listResearchRetryCandidates: vi.fn(),
}));

vi.mock("#modules/autonomy/commit.js", () => ({
  commitWorkflowChanges: vi.fn(),
}));

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

async function setCandidates(
  candidates: Array<{ id: string; updatedAt: string; urls: string[] }>,
) {
  const { listResearchRetryCandidates } = await import("./candidates.js");
  vi.mocked(listResearchRetryCandidates).mockReturnValue(candidates);
}

describe("research-retry workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips the agent step when there are no blocked research candidates", async () => {
    await mockCleanWorktree();
    await setCandidates([]);

    const harness = new WorkflowTestHarness(researchRetryWorkflow, {
      trigger: { event: "autonomy.queue.available", payload: {} },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-candidates"].output).toMatchObject({
      candidate: null,
      candidateCount: 0,
    });
    expect(result.steps.retry.status).toBe("skipped");
    expect(result.steps.commit.status).toBe("skipped");
  });

  it("skips the agent step when worktree is dirty", async () => {
    const { getRepoWorktreeStatus } = await import("#core/util/repo-worktree.js");
    vi.mocked(getRepoWorktreeStatus).mockReturnValue({
      available: true,
      dirty: true,
      trackedDirty: true,
      entries: [" M data/tasks/blocked/x.md"],
      fingerprint: " M data/tasks/blocked/x.md",
      summary: "data/tasks/blocked/x.md",
      headSha: "abc1234",
    });
    await setCandidates([
      { id: "task-a", updatedAt: "2026-04-20T00:00:00.000Z", urls: ["https://x.com/foo/status/1"] },
    ]);

    const harness = new WorkflowTestHarness(researchRetryWorkflow, {
      trigger: { event: "autonomy.queue.available", payload: {} },
    });

    const result = await harness.run();

    expect(result.steps.retry.status).toBe("skipped");
  });

  it("picks the oldest candidate and runs the agent step when there's work", async () => {
    await mockCleanWorktree();
    await setCandidates([
      {
        id: "task-old",
        updatedAt: "2026-04-14T00:29:07.947Z",
        urls: ["https://openai.com/index/x/", "https://x.com/a/status/1"],
      },
      {
        id: "task-new",
        updatedAt: "2026-04-20T20:18:43.712Z",
        urls: ["https://example.com/article"],
      },
    ]);
    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const harness = new WorkflowTestHarness(researchRetryWorkflow, {
      trigger: { event: "autonomy.queue.available", payload: {} },
      stepMocks: {
        retry: { turns: [], totalCostUsd: 0.01 },
      },
    });

    const result = await harness.run();

    expect(result.steps["inspect-candidates"].output).toMatchObject({
      candidate: { id: "task-old" },
      candidateCount: 2,
    });
    expect(result.steps.retry.status).toBe("success");
    expect(result.steps.commit.status).toBe("success");
  });

  it("skips all work on runtime.recovered triggers", async () => {
    await mockCleanWorktree();
    await setCandidates([
      { id: "task-a", updatedAt: "2026-04-14T00:00:00.000Z", urls: ["https://example.com/"] },
    ]);
    const harness = new WorkflowTestHarness(researchRetryWorkflow, {
      trigger: { event: "runtime.recovered", payload: {} },
    });

    const result = await harness.run();
    expect(result.steps["inspect-candidates"].status).toBe("skipped");
    expect(result.steps.retry.status).toBe("skipped");
  });
});
