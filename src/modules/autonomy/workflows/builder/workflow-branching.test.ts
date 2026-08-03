import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import "./workflow-test-support.js";
import builderWorkflow from "./workflow.js";
import {
  makeEmptySnapshot,
  makeSnapshot,
  makeWorkflowProject,
  resetBuilderWorkflowMocks,
} from "./workflow-test-support.js";

describe("builder workflow branch-per-task path", () => {
  beforeEach(async () => {
    await resetBuilderWorkflowMocks();
  });

  it("runs create-task-branch after build and skips create-pr when branchPerTask=false", async () => {
    const snapshot = makeSnapshot(1, 0);

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true, committedPaths: ["src/change.ts"], daemonRestartRequired: true } as never);

    const harness = new WorkflowTestHarness(builderWorkflow, {
      projectDir: makeWorkflowProject(snapshot),
      trigger: {
        event: "autonomy.queue.available",
        payload: { pullableCount: 5, actionableCount: 1, counts: snapshot.counts },
      },
      stepMocks: { build: { turns: [], totalCostUsd: 0.01 } },
    });

    const result = await harness.run();

    expect(result.steps["create-task-branch"].status).toBe("success");
    expect(result.steps["create-task-branch"].output).toMatchObject({ branchPerTask: false });
    expect(result.steps.commit.status).toBe("success");
    expect(result.steps["create-pr"]?.status ?? "skipped").toBe("skipped");
  });

  it("runs create-pr and returns PR URL when branchPerTask=true", async () => {
    const snapshot = makeSnapshot(1, 0);

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true, committedPaths: ["src/change.ts"], daemonRestartRequired: true } as never);

    const harness = new WorkflowTestHarness(builderWorkflow, {
      projectDir: makeWorkflowProject(snapshot),
      trigger: {
        event: "autonomy.queue.available",
        payload: {
          pullableCount: 5,
          actionableCount: 1,
          counts: snapshot.counts,
          branchPerTask: true,
          prUrl: "https://github.com/org/repo/pull/42",
        },
      },
      stepMocks: { build: { turns: [], totalCostUsd: 0.05 } },
    });

    const result = await harness.run();

    expect(result.steps["create-task-branch"].output).toMatchObject({
      branchPerTask: true,
      branch: "kota/task/task-foo",
    });
    expect(result.steps["create-pr"].status).toBe("success");
    expect(result.steps["create-pr"].output).toMatchObject({
      prUrl: "https://github.com/org/repo/pull/42",
    });
  });

  it("propagates create-pr failure as run failure", async () => {
    const snapshot = makeSnapshot(1, 0);

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true, committedPaths: ["src/change.ts"], daemonRestartRequired: true } as never);

    const harness = new WorkflowTestHarness(builderWorkflow, {
      projectDir: makeWorkflowProject(snapshot),
      trigger: {
        event: "autonomy.queue.available",
        payload: {
          pullableCount: 5,
          actionableCount: 1,
          counts: snapshot.counts,
          branchPerTask: true,
          prError: true,
        },
      },
      stepMocks: { build: { turns: [], totalCostUsd: 0.05 } },
    });

    const result = await harness.run();

    expect(result.status).toBe("failed");
    expect(result.steps["create-pr"].status).toBe("failed");
    expect(result.steps["create-pr"].error).toMatch(/gh CLI is not available/);
  });

  it("skips branch and PR steps when build is skipped", async () => {
    const snapshot = makeEmptySnapshot();

    const harness = new WorkflowTestHarness(builderWorkflow, {
      projectDir: makeWorkflowProject(snapshot),
      trigger: {
        event: "autonomy.queue.available",
        payload: { pullableCount: 5, actionableCount: 1, counts: snapshot.counts },
      },
      stepMocks: { build: { turns: [], totalCostUsd: 0 } },
    });

    const result = await harness.run();

    expect(result.steps.build.status).toBe("skipped");
    expect(result.steps["create-task-branch"].status).toBe("skipped");
    expect(result.steps["create-pr"].status).toBe("skipped");
    expect(result.steps["cleanup-merged-branches"].status).toBe("skipped");
  });

  it("runs cleanup-merged-branches after create-pr when branchPerTask=true", async () => {
    const snapshot = makeSnapshot(1, 0);

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true, committedPaths: ["src/change.ts"], daemonRestartRequired: true } as never);

    const harness = new WorkflowTestHarness(builderWorkflow, {
      projectDir: makeWorkflowProject(snapshot),
      trigger: {
        event: "autonomy.queue.available",
        payload: {
          pullableCount: 5,
          actionableCount: 1,
          counts: snapshot.counts,
          branchPerTask: true,
          prUrl: "https://github.com/org/repo/pull/42",
          cleanedBranches: ["kota/task/task-old"],
        },
      },
      stepMocks: { build: { turns: [], totalCostUsd: 0.05 } },
    });

    const result = await harness.run();

    expect(result.steps["cleanup-merged-branches"].status).toBe("success");
    expect(result.steps["cleanup-merged-branches"].output).toMatchObject({
      cleaned: ["kota/task/task-old"],
      warnings: [],
    });
  });

  it("skips cleanup when branchPerTask=false and tolerates cleanup warnings", async () => {
    const snapshot = makeSnapshot(1, 0);

    const { commitWorkflowChanges } = await import("#modules/autonomy/commit.js");
    vi.mocked(commitWorkflowChanges).mockResolvedValue({ committed: true, committedPaths: ["src/change.ts"], daemonRestartRequired: true } as never);

    const harness = new WorkflowTestHarness(builderWorkflow, {
      projectDir: makeWorkflowProject(snapshot),
      trigger: {
        event: "autonomy.queue.available",
        payload: { pullableCount: 5, actionableCount: 1, counts: snapshot.counts },
      },
      stepMocks: { build: { turns: [], totalCostUsd: 0.01 } },
    });

    const result = await harness.run();

    expect(result.steps["create-pr"].status).toBe("skipped");
    expect(result.steps["cleanup-merged-branches"].status).toBe("skipped");
  });
});
