import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertClaimAwareStrategicReadyCoverage,
  hasClaimAwareStrategicReadyCoverageGap,
} from "./strategic-ready-coverage.js";
import {
  claimTask,
  expireTaskClaim,
  markTaskClaimPendingMerge,
} from "./task-claims.js";
import {
  claimInput,
  makeProject,
} from "./task-claims-test-support.js";

function writeQueueTask(
  projectDir: string,
  state: "ready" | "backlog" | "blocked",
  taskId: string,
  priority: "p1" | "p2" | "p3",
): void {
  writeFileSync(
    join(projectDir, "data/tasks", state, `${taskId}.md`),
    [
      "---",
      `id: ${taskId}`,
      `title: ${taskId}`,
      `status: ${state}`,
      `priority: ${priority}`,
      "area: autonomy",
      "task_class: Platform",
      "summary: Test task.",
      "updated_at: 2026-07-08T00:00:00.000Z",
      "---",
      "",
      "## Problem",
      "",
      "Test.",
      "",
    ].join("\n"),
    "utf8",
  );
}

describe("claim-aware strategic ready coverage", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = makeProject();
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("treats a pending-merge strategic ready task as not satisfying coverage", () => {
    writeQueueTask(projectDir, "ready", "task-p3", "p3");
    writeQueueTask(projectDir, "ready", "task-strategic", "p1");
    const original = claimTask(
      claimInput(projectDir, "task-strategic", "run-a", new Date("2026-07-08T01:00:00.000Z")),
    );
    expect(original.claimed).toBe(true);
    markTaskClaimPendingMerge({
      projectDir,
      taskId: "task-strategic",
      runId: "run-a",
      workflowId: "builder",
      evidence: "builder branch is pending merge",
      now: new Date("2026-07-08T01:00:01.000Z"),
    });

    expect(
      hasClaimAwareStrategicReadyCoverageGap(
        projectDir,
        new Date("2026-07-08T01:00:02.000Z"),
      ),
    ).toBe(true);
    expect(() =>
      assertClaimAwareStrategicReadyCoverage(
        projectDir,
        new Date("2026-07-08T01:00:02.000Z"),
      ),
    ).toThrow("data/tasks/ready must keep at least one p0/p1/p2 task");
  });

  it("allows a safe-to-retry strategic claim to satisfy coverage", () => {
    writeQueueTask(projectDir, "ready", "task-p3", "p3");
    writeQueueTask(projectDir, "ready", "task-strategic", "p2");
    const original = claimTask(
      claimInput(projectDir, "task-strategic", "run-a", new Date("2026-07-08T01:00:00.000Z")),
    );
    expect(original.claimed).toBe(true);
    expireTaskClaim({
      projectDir,
      taskId: "task-strategic",
      runId: "run-a",
      workflowId: "builder",
      evidence: "claim expired before retry",
      now: new Date("2026-07-08T01:00:01.000Z"),
    });

    expect(
      hasClaimAwareStrategicReadyCoverageGap(
        projectDir,
        new Date("2026-07-08T01:00:02.000Z"),
      ),
    ).toBe(false);
    expect(
      assertClaimAwareStrategicReadyCoverage(
        projectDir,
        new Date("2026-07-08T01:00:02.000Z"),
      ),
    ).toBe("strategic-ready-coverage-ok");
  });

  it("allows ordinary strategic ready work to satisfy coverage", () => {
    writeQueueTask(projectDir, "ready", "task-p3", "p3");
    writeQueueTask(projectDir, "ready", "task-strategic", "p2");

    expect(hasClaimAwareStrategicReadyCoverageGap(projectDir)).toBe(false);
  });
});
