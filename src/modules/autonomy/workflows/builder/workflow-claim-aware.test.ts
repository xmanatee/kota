import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/index.js";
import {
  type ClaimAwareRepoTaskQueueSnapshot,
  getClaimAwareRepoTaskQueueSnapshot,
} from "#modules/autonomy/queue-availability.js";
import "./workflow-test-support.js";
import builderWorkflow from "./workflow.js";
import {
  makeSnapshot,
  makeWorkflowProject,
  resetBuilderWorkflowMocks,
} from "./workflow-test-support.js";

vi.mock("#modules/autonomy/queue-availability.js", () => ({
  getClaimAwareRepoTaskQueueSnapshot: vi.fn(),
}));

describe("builder workflow claim-aware queue gating", () => {
  beforeEach(async () => {
    await resetBuilderWorkflowMocks();
  });

  it("skips claim and build when every visible ready task is pending merge", async () => {
    const rawSnapshot = makeSnapshot(1, 0, 0);
    const snapshot: ClaimAwareRepoTaskQueueSnapshot = {
      ...rawSnapshot,
      actionableCount: 0,
      dispatchableCount: 0,
      hasDispatchableWork: false,
      claimBlockedTasks: [
        {
          id: "task-owned",
          title: "Owned task",
          state: "ready",
          claimStatus: "pending-merge",
          recoveryStatus: "pending-merge",
          recoveryPath: "skipped-pending-merge",
          owner: "workflow:builder",
          runId: "run-pending",
          workflowId: "builder",
          evidence: "builder branch is pending merge",
          recoveryCommand: "pnpm kota workflow state-recovery list",
          resolveCommand:
            'pnpm kota workflow state-recovery resolve task-owned --action <release|supersede> --reason "<reason>"',
        },
      ],
    };
    vi.mocked(getClaimAwareRepoTaskQueueSnapshot).mockReturnValue(snapshot);

    const harness = new WorkflowTestHarness(builderWorkflow, {
      projectDir: makeWorkflowProject(rawSnapshot),
      trigger: {
        event: "autonomy.queue.available",
        payload: {
          pullableCount: 1,
          actionableCount: 0,
          counts: snapshot.counts,
          claimBlockedTasks: snapshot.claimBlockedTasks,
        },
      },
      stepMocks: {
        build: { turns: [], totalCostUsd: 0.03 },
      },
    });

    const result = await harness.run();

    expect(result.steps["inspect-ready-queue"].output).toMatchObject({
      pullableCount: 1,
      actionableCount: 0,
      claimBlockedTasks: snapshot.claimBlockedTasks,
    });
    const { claimNextQueueTask } = await import("#modules/autonomy/task-claims.js");
    expect(claimNextQueueTask).not.toHaveBeenCalled();
    expect(result.steps["claim-task"].status).toBe("skipped");
    expect(result.steps.build.status).toBe("skipped");
  });
});
