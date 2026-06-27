import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import "./workflow-test-support.js";
import builderWorkflow from "./workflow.js";
import {
  makeSnapshot,
  makeWorkflowProject,
  resetBuilderWorkflowMocks,
} from "./workflow-test-support.js";

describe("builder workflow run path", () => {
  beforeEach(async () => {
    await resetBuilderWorkflowMocks();
  });

  it("runs build and commit when ready or doing work exists", async () => {
    const snapshot = makeSnapshot(2, 1);

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const harness = new WorkflowTestHarness(builderWorkflow, {
      projectDir: makeWorkflowProject(snapshot),
      trigger: {
        event: "autonomy.queue.available",
        payload: { pullableCount: 3, actionableCount: 3, counts: snapshot.counts },
      },
      stepMocks: {
        build: { turns: [], totalCostUsd: 0.05 },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-ready-queue"].status).toBe("success");
    expect(result.steps["claim-task"].status).toBe("success");
    expect(result.steps["claim-task"].output).toMatchObject({
      claimed: true,
      taskId: "task-claimed",
    });
    expect(result.steps.build.status).toBe("success");
    expect(result.steps.build.output).toMatchObject({ totalCostUsd: 0.05 });
    expect(result.steps.commit.status).toBe("success");
  });

  it("skips commit and write-run-summary when build fails", async () => {
    const snapshot = makeSnapshot(1, 0);

    const harness = new WorkflowTestHarness(builderWorkflow, {
      projectDir: makeWorkflowProject(snapshot),
      trigger: {
        event: "autonomy.queue.available",
        payload: { pullableCount: 5, actionableCount: 1, counts: snapshot.counts },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("failed");
    expect(result.steps.build.status).toBe("failed");
    expect(result.steps.build.error).toMatch(/requires a mock/);
    expect(result.steps.commit).toBeUndefined();
  });

  it("emits workflow.build.committed after a successful commit with run-summary payload", async () => {
    const snapshot = makeSnapshot(1, 0);

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const { writeBuilderRunSummary } = await import("./run-summary.js");
    vi.mocked(writeBuilderRunSummary).mockReturnValue({
      runId: "run-abc",
      workflow: "builder",
      taskId: "task-claimed",
      taskTitle: "Claimed task",
      outcome: "success",
      commitSha: "abc123",
      commitMessage: "Complete claimed task",
      filesChanged: ["src/foo.ts"],
      costUsd: 0.42,
      durationMs: 480000,
      completedAt: "2026-04-02T10:00:00Z",
    });

    const harness = new WorkflowTestHarness(builderWorkflow, {
      projectDir: makeWorkflowProject(snapshot),
      trigger: {
        event: "autonomy.queue.available",
        payload: { pullableCount: 5, actionableCount: 1, counts: snapshot.counts },
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
      taskId: "task-claimed",
      commitMessage: "Complete claimed task",
      costUsd: 0.42,
      durationMs: 480000,
    });
  });

  it("fails before commit emission or claim release when run-summary task differs from the claim", async () => {
    const snapshot = makeSnapshot(1, 0);

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true } as never);

    const { writeBuilderRunSummary } = await import("./run-summary.js");
    vi.mocked(writeBuilderRunSummary).mockReturnValue({
      runId: "run-abc",
      workflow: "builder",
      taskId: "task-other",
      taskTitle: "Other task",
      outcome: "success",
      commitSha: "abc123",
      commitMessage: "Complete other task",
      filesChanged: ["data/tasks/done/task-other.md"],
      costUsd: 0.42,
      durationMs: 480000,
      completedAt: "2026-04-02T10:00:00Z",
    });

    const harness = new WorkflowTestHarness(builderWorkflow, {
      projectDir: makeWorkflowProject(snapshot),
      trigger: {
        event: "autonomy.queue.available",
        payload: { pullableCount: 5, actionableCount: 1, counts: snapshot.counts },
      },
      stepMocks: {
        build: { turns: [], totalCostUsd: 0.42 },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("failed");
    expect(result.steps["check-claimed-task-consistency"].status).toBe("failed");
    expect(result.steps["check-claimed-task-consistency"].error).toMatch(
      /claimed task-claimed but run-summary identified task-other/,
    );
    expect(result.steps["emit-build-committed"]).toBeUndefined();
    expect(result.steps["release-task-claim"]).toBeUndefined();
    expect(result.emitted.find((e) => e.event === "workflow.build.committed")).toBeUndefined();

    const { releaseTaskClaim } = await import("#modules/autonomy/task-claims.js");
    expect(releaseTaskClaim).not.toHaveBeenCalled();
  });

  it("includes inspect-ready-queue snapshot in step output", async () => {
    const snapshot = makeSnapshot(3, 0);

    const harness = new WorkflowTestHarness(builderWorkflow, {
      projectDir: makeWorkflowProject(snapshot),
      trigger: {
        event: "autonomy.queue.available",
        payload: { pullableCount: 3, actionableCount: 3, counts: snapshot.counts },
      },
      stepMocks: {
        build: { turns: [], totalCostUsd: 0.05 },
      },
    });

    const result = await harness.run();

    expect(result.steps["inspect-ready-queue"].output).toMatchObject({
      actionableCount: 3,
      pullableCount: 7,
      dirty: false,
    });
  });
});
