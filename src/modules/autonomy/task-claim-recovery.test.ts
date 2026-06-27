import { existsSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claimTask,
  expireTaskClaim,
  listTaskClaimInspections,
  markTaskClaimPendingMerge,
  releaseTaskClaim,
  resumeTaskClaim,
  taskClaimPath,
} from "./task-claims.js";
import { claimInput, makeProject, writeTask } from "./task-claims-test-support.js";

let projectDir: string;

describe("task claim recovery lifecycle", () => {
  beforeEach(() => {
    projectDir = makeProject();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("lists stale claims and supports resume, pending, expire, replace, and release recovery", () => {
    writeTask(projectDir, "ready", "task-alpha", "2026-06-27T00:00:00.000Z");
    const acquiredAt = new Date("2026-06-27T01:00:00.000Z");
    const claim = claimTask({
      ...claimInput(projectDir, "task-alpha", "run-a", acquiredAt),
      leaseMs: 1_000,
    });
    expect(claim.claimed).toBe(true);

    const staleAt = new Date("2026-06-27T01:00:02.000Z");
    expect(listTaskClaimInspections(projectDir, staleAt)[0]).toMatchObject({
      recoveryStatus: "stale",
      safeToRetry: true,
    });

    const resumed = resumeTaskClaim({
      projectDir,
      taskId: "task-alpha",
      runId: "run-a",
      workflowId: "builder",
      evidence: "daemon restarted and resumed the same builder run",
      leaseMs: 60_000,
      now: staleAt,
    });
    expect(resumed).toMatchObject({
      changed: true,
      recoveryStatus: "agent-running",
      safeToRetry: false,
    });

    const pending = markTaskClaimPendingMerge({
      projectDir,
      taskId: "task-alpha",
      runId: "run-a",
      workflowId: "builder",
      evidence: "merge conflict needs resolution",
      now: new Date("2026-06-27T01:00:03.000Z"),
    });
    expect(pending).toMatchObject({
      recoveryStatus: "pending-merge",
      safeToRetry: false,
    });

    const skipped = claimTask(claimInput(projectDir, "task-alpha", "run-b", new Date("2026-06-27T01:00:04.000Z")));
    expect(skipped).toMatchObject({
      claimed: false,
      recoveryPath: "skipped-pending-merge",
    });

    const expired = expireTaskClaim({
      projectDir,
      taskId: "task-alpha",
      runId: "run-a",
      workflowId: "builder",
      evidence: "operator expired abandoned claim",
      now: new Date("2026-06-27T01:00:05.000Z"),
    });
    expect(expired).toMatchObject({
      recoveryStatus: "expired",
      safeToRetry: true,
    });

    const replacement = claimTask(claimInput(projectDir, "task-alpha", "run-c", new Date("2026-06-27T01:00:06.000Z")));
    expect(replacement).toMatchObject({
      claimed: true,
      recoveryPath: "replaced-expired-claim",
    });

    const released = releaseTaskClaim({
      projectDir,
      taskId: "task-alpha",
      runId: "run-c",
      workflowId: "builder",
      evidence: "merged successfully",
      now: new Date("2026-06-27T01:00:07.000Z"),
    });
    expect(released).toMatchObject({
      changed: true,
      recoveryStatus: "released",
      safeToRetry: true,
    });
    expect(existsSync(taskClaimPath(projectDir, "task-alpha"))).toBe(false);
  });
});
