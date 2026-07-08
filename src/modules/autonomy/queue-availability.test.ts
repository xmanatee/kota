import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getClaimAwareRepoTaskQueueSnapshot, isThinClaimAwareDispatchableQueue } from "./queue-availability.js";
import {
  claimTask,
  markTaskClaimPendingMerge,
} from "./task-claims.js";
import {
  claimInput,
  makeProject,
  writeTask,
} from "./task-claims-test-support.js";

describe("claim-aware queue availability", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProject();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("subtracts pending-merge ready claims from ordinary actionability", () => {
    writeTask(projectDir, "ready", "task-alpha", "2026-06-27T00:00:00.000Z");
    const original = claimTask(
      claimInput(projectDir, "task-alpha", "run-a", new Date("2026-06-27T01:00:00.000Z")),
    );
    expect(original.claimed).toBe(true);
    markTaskClaimPendingMerge({
      projectDir,
      taskId: "task-alpha",
      runId: "run-a",
      workflowId: "builder",
      evidence: "merge gate is pending",
      now: new Date("2026-06-27T01:00:01.000Z"),
    });

    const snapshot = getClaimAwareRepoTaskQueueSnapshot(
      projectDir,
      new Date("2026-06-27T01:00:02.000Z"),
    );

    expect(snapshot.counts.ready).toBe(1);
    expect(snapshot.pullableCount).toBe(1);
    expect(snapshot.actionableCount).toBe(0);
    expect(snapshot.dispatchableCount).toBe(0);
    expect(snapshot.hasDispatchableWork).toBe(false);
    expect(snapshot.claimBlockedTasks).toEqual([
      {
        id: "task-alpha",
        title: "task-alpha",
        state: "ready",
        claimStatus: "pending-merge",
        recoveryStatus: "pending-merge",
        recoveryPath: "skipped-pending-merge",
        owner: "workflow:builder:run-a",
        runId: "run-a",
        workflowId: "builder",
        evidence: "merge gate is pending",
        recoveryCommand: "pnpm kota workflow state-recovery list",
        resolveCommand:
          'pnpm kota workflow state-recovery resolve task-alpha --action <release|supersede> --reason "<reason>"',
      },
    ]);
    expect(isThinClaimAwareDispatchableQueue(snapshot)).toBe(false);
  });
});
