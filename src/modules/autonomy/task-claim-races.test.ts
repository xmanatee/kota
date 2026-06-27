import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ClaimTaskAttempt, QueueTaskClaimResult } from "./task-claims.js";
import { listTaskClaimInspections } from "./task-claims.js";
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

  it("claims different dependency-clear tasks when selectors race across the queue", async () => {
    writeTask(projectDir, "ready", "task-alpha", "2026-06-27T00:00:00.000Z");
    writeTask(projectDir, "ready", "task-beta", "2026-06-27T00:01:00.000Z");
    const now = new Date("2026-06-27T01:00:00.000Z");
    const barrier = makeClaimRaceBarrier(projectDir, "queue-selectors");

    const [first, second] = await runConcurrentClaimWorkers<QueueTaskClaimResult>([
      {
        ...queueInput(projectDir, "run-a", now),
        ...barrier,
        operation: "claim-next",
        workerId: "run-a",
        now: now.toISOString(),
      },
      {
        ...queueInput(projectDir, "run-b", now),
        ...barrier,
        operation: "claim-next",
        workerId: "run-b",
        now: now.toISOString(),
      },
    ]);

    expect(new Set([first.taskId, second.taskId])).toEqual(new Set(["task-alpha", "task-beta"]));
    expect([...first.skipped, ...second.skipped].map((attempt) => attempt.taskId)).toContain("task-alpha");
    expect(listTaskClaimInspections(projectDir, now).filter((claim) => !claim.safeToRetry)).toHaveLength(2);
  });
});
