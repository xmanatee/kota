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

describe("builder workflow queue gating", () => {
  beforeEach(async () => {
    await resetBuilderWorkflowMocks();
  });

  it("only wakes from actionable queue availability and recovery", () => {
    expect(builderWorkflow.triggers.map((trigger) => trigger.event)).toEqual([
      "autonomy.queue.available",
      "runtime.recovered",
    ]);
  });

  it("uses worktree-backed dispatch by default with an explicit opt-out", () => {
    const maxConcurrentRuns = builderWorkflow.maxConcurrentRuns;
    const dispatchBurst = builderWorkflow.dispatchBurst;
    if (typeof maxConcurrentRuns !== "function") {
      throw new Error("builder maxConcurrentRuns must be config-gated");
    }
    if (typeof dispatchBurst !== "function") {
      throw new Error("builder dispatchBurst must be config-gated");
    }

    const base = {
      projectDir: "/repo",
      workflowName: "builder",
      trigger: {
        event: "autonomy.queue.available",
        schemaRef: null,
        payload: { actionableCount: 3 },
      },
    };

    expect(maxConcurrentRuns({ ...base, config: undefined })).toBe(2);
    expect(dispatchBurst({ ...base, config: undefined })).toBe(2);
    expect(maxConcurrentRuns({ ...base, config: { modules: {} } })).toBe(2);
    expect(dispatchBurst({ ...base, config: { modules: {} } })).toBe(2);
    expect(maxConcurrentRuns({ ...base, config: { modules: { builder: { branchPerTask: true } } } })).toBe(2);
    expect(dispatchBurst({ ...base, config: { modules: { builder: { branchPerTask: true } } } })).toBe(2);
    expect(maxConcurrentRuns({ ...base, config: { modules: { builder: { branchPerTask: false } } } })).toBe(1);
    expect(dispatchBurst({ ...base, config: { modules: { builder: { branchPerTask: false } } } })).toBe(1);
  });

  it("skips build when worktree is dirty", async () => {
    const snapshot = makeSnapshot(2, 1);
    const projectDir = makeWorkflowProject(snapshot, {
      available: true,
      dirty: true,
      trackedDirty: true,
      entries: ["M src/foo.ts"],
      fingerprint: "M src/foo.ts",
      summary: "src/foo.ts",
      headSha: "abc1234",
    });

    const harness = new WorkflowTestHarness(builderWorkflow, {
      projectDir,
      trigger: {
        event: "autonomy.queue.available",
        payload: { pullableCount: 7, actionableCount: 3, counts: snapshot.counts },
      },
      stepMocks: { build: { turns: [], totalCostUsd: 0 } },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-ready-queue"].output).toMatchObject({ dirty: true });
    expect(result.steps["claim-task"].status).toBe("skipped");
    expect(result.steps.build.status).toBe("skipped");
  });

  it("resets worktree and skips build on runtime.recovered trigger", async () => {
    const projectDir = makeWorkflowProject(makeSnapshot(2, 1));

    const { resetWorktreeForRecovery } = await import("#modules/autonomy/recovery.js");
    vi.mocked(resetWorktreeForRecovery).mockReturnValue({
      stashed: true,
      stashSummary: "1 file stashed",
      branchRestored: true,
      previousBranch: "kota/task/task-foo",
      currentBranch: "main",
    });

    const harness = new WorkflowTestHarness(builderWorkflow, {
      projectDir,
      trigger: {
        event: "runtime.recovered",
        payload: { reason: "dirty-worktree-after-crash" },
      },
      stepMocks: { build: { turns: [], totalCostUsd: 0 } },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["reset-for-recovery"].status).toBe("success");
    expect(result.steps["reset-for-recovery"].output).toMatchObject({
      stashed: true,
      branchRestored: true,
      previousBranch: "kota/task/task-foo",
      currentBranch: "main",
    });
    expect(vi.mocked(resetWorktreeForRecovery)).toHaveBeenCalledWith(
      expect.objectContaining({ workflowName: "builder", restoreBaseBranch: true }),
    );
    expect(result.steps["claim-task"].status).toBe("skipped");
    expect(result.steps.build.status).toBe("skipped");
    expect(result.steps.commit.status).toBe("skipped");
    expect(result.steps["write-run-summary"].status).toBe("skipped");
    expect(result.steps["emit-build-committed"].status).toBe("skipped");
    expect(result.steps["request-restart"].status).toBe("skipped");
  });

  it("skips build and commit when no actionable queue work exists", async () => {
    const snapshot = makeEmptySnapshot();

    const harness = new WorkflowTestHarness(builderWorkflow, {
      projectDir: makeWorkflowProject(snapshot),
      trigger: {
        event: "autonomy.queue.available",
        payload: { pullableCount: 0, actionableCount: 0, counts: snapshot.counts },
      },
      stepMocks: {
        build: { turns: [], totalCostUsd: 0 },
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("success");
    expect(result.steps["inspect-ready-queue"].status).toBe("success");
    expect(result.steps["claim-task"].status).toBe("skipped");
    expect(result.steps.build.status).toBe("skipped");
    expect(result.steps.commit.status).toBe("skipped");
    expect(result.steps["write-run-summary"].status).toBe("skipped");
    expect(result.steps["emit-build-committed"].status).toBe("skipped");
    expect(result.steps["request-restart"].status).toBe("skipped");
  });

  it("skips build when only backlog tasks remain", async () => {
    const snapshot = makeSnapshot(0, 0, 2);

    const harness = new WorkflowTestHarness(builderWorkflow, {
      projectDir: makeWorkflowProject(snapshot),
      trigger: {
        event: "autonomy.queue.available",
        payload: {
          pullableCount: 2,
          actionableCount: 0,
          counts: snapshot.counts,
        },
      },
      stepMocks: {
        build: { turns: [], totalCostUsd: 0.03 },
      },
    });

    const result = await harness.run();

    expect(result.steps["claim-task"].status).toBe("skipped");
    expect(result.steps.build.status).toBe("skipped");
    expect(result.steps.commit.status).toBe("skipped");
  });

  it("skips build when every ready task is waiting on hard dependencies", async () => {
    const snapshot = {
      ...makeSnapshot(1, 0, 0),
      pullableCount: 0,
      actionableCount: 0,
      dependencyBlockedTasks: [
        {
          id: "task-dependent",
          title: "Dependent",
          state: "ready" as const,
          dependsOn: ["task-enabler"],
          waitingOn: ["task-enabler"],
        },
      ],
    };

    const harness = new WorkflowTestHarness(builderWorkflow, {
      projectDir: makeWorkflowProject(snapshot),
      trigger: {
        event: "autonomy.queue.available",
        payload: {
          pullableCount: 0,
          actionableCount: 0,
          counts: makeSnapshot(1, 0, 0).counts,
        },
      },
      stepMocks: {
        build: { turns: [], totalCostUsd: 0.03 },
      },
    });

    const result = await harness.run();

    expect(result.steps["claim-task"].status).toBe("skipped");
    expect(result.steps.build.status).toBe("skipped");
  });

  it("skips build when every actionable candidate is already claimed", async () => {
    const snapshot = makeSnapshot(1, 0);

    const { claimNextQueueTask } = await import("#modules/autonomy/task-claims.js");
    vi.mocked(claimNextQueueTask).mockReturnValueOnce({
      claimed: false,
      taskId: null,
      claim: null,
      recoveryStatus: null,
      safeToRetry: true,
      recoveryPath: "no-actionable-task",
      reason: "all candidate tasks are claimed",
      candidateCount: 1,
      skipped: [
        {
          claimed: false,
          taskId: "task-owned",
          claim: null,
          recoveryStatus: "agent-running",
          safeToRetry: false,
          recoveryPath: "skipped-active-claim",
          reason: "task is already claimed",
        },
      ],
      activeClaims: [],
    });

    const harness = new WorkflowTestHarness(builderWorkflow, {
      projectDir: makeWorkflowProject(snapshot),
      trigger: {
        event: "autonomy.queue.available",
        payload: { pullableCount: 1, actionableCount: 1, counts: snapshot.counts },
      },
      stepMocks: {
        build: { turns: [], totalCostUsd: 0.03 },
      },
    });

    const result = await harness.run();

    expect(result.steps["claim-task"].status).toBe("success");
    expect(result.steps["claim-task"].output).toMatchObject({
      claimed: false,
      reason: "all candidate tasks are claimed",
    });
    expect(result.steps.build.status).toBe("skipped");
  });
});
