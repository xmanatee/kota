import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkflowTestHarness } from "#core/workflow/testing/testing-api.js";
import {
  claimTask,
  markTaskClaimPendingMerge,
} from "#modules/autonomy/task-claims.js";
import {
  makeProject,
  writeTask,
} from "#modules/autonomy/task-claims-test-support.js";
import dispatcherWorkflow from "./workflow.js";

describe("dispatcher claim-aware queue availability", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProject();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("stays quiescent for a pending-merge ready task", async () => {
    writeTask(projectDir, "ready", "task-pending", "2026-06-27T00:00:00.000Z");
    const claim = claimTask({
      projectDir,
      taskId: "task-pending",
      taskState: "ready",
      runId: "run-pending",
      workflowId: "builder",
      owner: "workflow:builder",
      workspaceDir: join(projectDir, ".worktrees", "run-pending"),
      branch: "kota/task/task-pending/run-pending",
      baseCommit: "abc1234",
      now: new Date("2026-06-27T00:00:00.000Z"),
    });
    expect(claim.claimed).toBe(true);
    markTaskClaimPendingMerge({
      projectDir,
      taskId: "task-pending",
      runId: "run-pending",
      workflowId: "builder",
      evidence: "builder branch is pending merge",
      now: new Date("2026-06-27T00:01:00.000Z"),
    });

    const result = await new WorkflowTestHarness(dispatcherWorkflow, {
      projectDir,
    }).run();

    const expectedClaimBlock = {
      id: "task-pending",
      title: "task-pending",
      state: "ready",
      claimStatus: "pending-merge",
      recoveryStatus: "pending-merge",
      recoveryPath: "skipped-pending-merge",
      owner: "workflow:builder",
      runId: "run-pending",
      workflowId: "builder",
      evidence: "builder branch is pending merge",
      recoveryCommand: "pnpm dev workflow state-recovery list",
      resolveCommand:
        'pnpm dev workflow state-recovery resolve task-pending --action <release|supersede> --reason "<reason>"',
    };
    const output = result.steps["assess-and-dispatch"].output as {
      pullableCount?: number;
      actionableCount?: number;
      dispatchableCount?: number;
      claimBlockedTasks?: unknown[];
      quiescent?: boolean;
      quiescentReason?: string | null;
    };

    expect(output.pullableCount).toBe(1);
    expect(output.actionableCount).toBe(0);
    expect(output.dispatchableCount).toBe(0);
    expect(output.claimBlockedTasks).toEqual([expectedClaimBlock]);
    expect(output.quiescent).toBe(true);
    expect(output.quiescentReason).toBe("work is dependency- or claim-blocked");
    expect(result.emitted.some((e) => e.event === "autonomy.queue.available")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.thin")).toBe(false);
    expect(result.emitted.some((e) => e.event === "autonomy.queue.empty")).toBe(false);
  });
});
