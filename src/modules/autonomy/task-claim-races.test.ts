import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ClaimTaskAttempt, QueueTaskClaimResult } from "./task-claims.js";
import { claimTask, listTaskClaimInspections } from "./task-claims.js";
import {
  claimInput,
  makeClaimRaceBarrier,
  makeProject,
  queueInput,
  runConcurrentClaimWorkers,
  writeTask,
} from "./task-claims-test-support.js";

let projectDir: string;

describe("task claim race leases", () => {
  beforeEach(() => {
    projectDir = makeProject();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("allows only one winner when two runs claim the same task", async () => {
    writeTask(projectDir, "ready", "task-alpha", "2026-06-27T00:00:00.000Z");
    const now = new Date("2026-06-27T01:00:00.000Z");
    const barrier = makeClaimRaceBarrier(projectDir, "same-task");

    const attempts = await runConcurrentClaimWorkers<ClaimTaskAttempt>([
      {
        ...claimInput(projectDir, "task-alpha", "run-a", now),
        ...barrier,
        operation: "claim-task",
        workerId: "run-a",
        now: now.toISOString(),
      },
      {
        ...claimInput(projectDir, "task-alpha", "run-b", now),
        ...barrier,
        operation: "claim-task",
        workerId: "run-b",
        now: now.toISOString(),
      },
    ]);

    expect(attempts.filter((attempt) => attempt.claimed)).toHaveLength(1);
    expect(attempts.filter((attempt) => !attempt.claimed)).toHaveLength(1);
    const loser = attempts.find((attempt) => !attempt.claimed);
    expect(loser?.safeToRetry).toBe(false);
    expect(["skipped-active-claim", "write-conflict"]).toContain(loser?.recoveryPath);
  });

  it("allows only one winner when two runs replace the same stale claim", async () => {
    writeTask(projectDir, "ready", "task-alpha", "2026-06-27T00:00:00.000Z");
    const acquiredAt = new Date("2026-06-27T01:00:00.000Z");
    const stale = claimTask({
      ...claimInput(projectDir, "task-alpha", "run-stale", acquiredAt),
      leaseMs: 1_000,
    });
    expect(stale.claimed).toBe(true);

    const now = new Date("2026-06-27T01:00:02.000Z");
    const barrier = makeClaimRaceBarrier(projectDir, "stale-replacement");
    const attempts = await runConcurrentClaimWorkers<ClaimTaskAttempt>([
      {
        ...claimInput(projectDir, "task-alpha", "run-a", now),
        ...barrier,
        operation: "replace-stale",
        workerId: "run-a",
        now: now.toISOString(),
      },
      {
        ...claimInput(projectDir, "task-alpha", "run-b", now),
        ...barrier,
        operation: "replace-stale",
        workerId: "run-b",
        now: now.toISOString(),
      },
    ]);

    expect(attempts.filter((attempt) => attempt.claimed)).toHaveLength(1);
    expect(attempts.filter((attempt) => !attempt.claimed)).toHaveLength(1);
    expect(attempts.find((attempt) => !attempt.claimed)).toMatchObject({
      recoveryPath: "write-conflict",
      reason: "claim changed during stale recovery",
    });
    expect(listTaskClaimInspections(projectDir, now)[0]?.claim.runId).toBe(
      attempts.find((attempt) => attempt.claimed)?.claim?.runId,
    );
  });

  it("claims distinct dependency-clear tasks across a four-way queue race", async () => {
    const taskIds = ["task-alpha", "task-beta", "task-gamma", "task-delta"];
    for (const [index, taskId] of taskIds.entries()) {
      writeTask(
        projectDir,
        "ready",
        taskId,
        `2026-06-27T00:0${index}:00.000Z`,
      );
    }
    const now = new Date("2026-06-27T01:00:00.000Z");
    const barrier = makeClaimRaceBarrier(projectDir, "queue-selectors");

    const results = await runConcurrentClaimWorkers<QueueTaskClaimResult>(
      ["run-a", "run-b", "run-c", "run-d"].map((runId) => ({
        ...queueInput(projectDir, runId, now),
        ...barrier,
        operation: "claim-next" as const,
        workerId: runId,
        now: now.toISOString(),
      })),
    );

    expect(new Set(results.map((result) => result.taskId))).toEqual(
      new Set(taskIds),
    );
    expect(
      results.flatMap((result) => result.skipped).map((attempt) => attempt.taskId),
    ).toContain("task-alpha");
    expect(
      listTaskClaimInspections(projectDir, now).filter(
        (claim) => !claim.safeToRetry,
      ),
    ).toHaveLength(4);
  });
});
