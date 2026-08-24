import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowRepairContinuationInput } from "#core/workflow/run-types.js";
import {
  classifyBuilderRepairTrajectory,
  inspectBuilderContinuationInWorker,
} from "./continuation-inspection.js";
import {
  CONTINUATION_TASK_ID,
  continuationTaskContent,
  continuationTrajectory,
  createContinuationInspectionFixture,
} from "./continuation-inspection.test-helpers.js";

describe("builder continuation inspection", () => {
  let projectDir: string;
  let runDir: string;
  let agentRunDir: string;

  beforeEach(() => {
    ({ projectDir, runDir, agentRunDir } = createContinuationInspectionFixture());
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it.each([
    {
      label: "stalled changing",
      input: continuationTrajectory([["lint"], ["lint"], ["lint"]], ["lint"]),
      classification: "stalled-changing",
    },
    {
      label: "expanding",
      input: continuationTrajectory([["lint"], ["lint"], ["lint"]], ["lint", "test"]),
      classification: "expanding",
    },
  ])(
    "opens a semantic boundary for a $label trajectory",
    ({ input, classification }) => {
      const inspection = inspectBuilderContinuationInWorker({
        projectDir,
        workspaceDir: projectDir,
        runDir,
        agentRunDir,
        runId: "run-long-builder",
        taskId: CONTINUATION_TASK_ID,
        priorRunIds: [],
        continuation: input,
      });

      expect(classifyBuilderRepairTrajectory(input)).toBe(classification);
      expect(inspection.packet).toMatchObject({
        attempt: 3,
        trajectory: { classification },
      });
      expect(inspection.packet?.boundaryReasons).toContain(
        `repair-trajectory:${classification}`,
      );
    },
  );

  it("lets a changing-and-converging trajectory continue without a review", () => {
    const input = continuationTrajectory(
      [
        ["lint", "test", "critic-review"],
        ["lint", "test"],
      ],
      ["lint"],
    );
    const inspection = inspectBuilderContinuationInWorker({
      projectDir,
      workspaceDir: projectDir,
      runDir,
      agentRunDir,
      runId: "run-long-builder",
      taskId: CONTINUATION_TASK_ID,
      priorRunIds: [],
      continuation: input,
    });

    expect(classifyBuilderRepairTrajectory(input)).toBe("converging");
    expect(inspection.packet).toBeNull();
  });

  it("opens a boundary when early convergence leaves one changing but persistent failure", () => {
    const input = continuationTrajectory(
      [
        ["lint", "test", "critic-review"],
        ["lint"],
        ["lint"],
      ],
      ["lint"],
    );
    const inspection = inspectBuilderContinuationInWorker({
      projectDir,
      workspaceDir: projectDir,
      runDir,
      agentRunDir,
      runId: "run-long-builder",
      taskId: CONTINUATION_TASK_ID,
      priorRunIds: [],
      continuation: input,
    });

    expect(classifyBuilderRepairTrajectory(input)).toBe("stalled-changing");
    expect(inspection.packet?.boundaryReasons).toContain(
      "repair-trajectory:stalled-changing",
    );
  });

  it("does not request judgment for fresh ordinary repair progress", () => {
    const input: WorkflowRepairContinuationInput = {
      ...continuationTrajectory([], ["lint"]),
      attempt: 1,
      repairIterations: [{ attempt: 1, failureIds: ["lint"] }],
    };
    const inspection = inspectBuilderContinuationInWorker({
      projectDir,
      workspaceDir: projectDir,
      runDir,
      agentRunDir,
      runId: "run-long-builder",
      taskId: CONTINUATION_TASK_ID,
      priorRunIds: [],
      continuation: input,
    });

    expect(inspection.packet).toBeNull();
  });

  it("opens a boundary when a repair introduces a new failure", () => {
    const input: WorkflowRepairContinuationInput = {
      ...continuationTrajectory([], ["lint", "test"]),
      attempt: 1,
      repairIterations: [{ attempt: 1, failureIds: ["lint"] }],
    };
    const inspection = inspectBuilderContinuationInWorker({
      projectDir,
      workspaceDir: projectDir,
      runDir,
      agentRunDir,
      runId: "run-long-builder",
      taskId: CONTINUATION_TASK_ID,
      priorRunIds: [],
      continuation: input,
    });

    expect(inspection.packet?.boundaryReasons).toContain("new-failures:test");
  });

  it("opens an acceptance-risk boundary without waiting for a retry cadence", () => {
    const input: WorkflowRepairContinuationInput = {
      ...continuationTrajectory([], ["acceptance-criteria"]),
      attempt: 0,
      repairIterations: [],
    };
    const inspection = inspectBuilderContinuationInWorker({
      projectDir,
      workspaceDir: projectDir,
      runDir,
      agentRunDir,
      runId: "run-long-builder",
      taskId: CONTINUATION_TASK_ID,
      priorRunIds: [],
      continuation: input,
    });

    expect(inspection.packet?.boundaryReasons).toContain(
      "unresolved-acceptance-criteria",
    );
  });

  it("reports explicitly unresolved criteria as addressed but not verified", () => {
    writeFileSync(
      join(projectDir, "data/tasks/ready/task-runtime-safety.md"),
      continuationTaskContent({
        id: "task-runtime-safety",
        title: "Repair runtime safety",
        status: "ready",
        priority: "p0",
        taskClass: "Safety",
      }),
    );
    writeFileSync(
      join(agentRunDir, "success-criteria.txt"),
      "1. First criterion.\n2. Second criterion.\n",
    );
    writeFileSync(
      join(agentRunDir, "success-criteria-verified.txt"),
      "1. Verified: focused tests passed.\n" +
        "2. Not verified: operator evidence is unavailable.\n",
    );
    const inspection = inspectBuilderContinuationInWorker({
      projectDir,
      workspaceDir: projectDir,
      runDir,
      agentRunDir,
      runId: "run-long-builder",
      taskId: CONTINUATION_TASK_ID,
      priorRunIds: [],
      continuation: {
        attempt: 0,
        failureIds: ["critic-review"],
        warningIds: [],
        progressKey: "initial-progress",
        previousProgressKey: "initial-progress",
        progressChanged: false,
        noProgressAttempts: 0,
        repairIterations: [],
      },
    });

    expect(
      inspection.packet?.context.find(
        (entry) => entry.label === "success-criteria",
      )?.value,
    ).toBe("1/2 verified; 2/2 addressed");
  });

  it("creates a boundary immediately when newly available Safety work outranks the claimed task", () => {
    writeFileSync(
      join(projectDir, "data/tasks/ready/task-runtime-safety.md"),
      continuationTaskContent({
        id: "task-runtime-safety",
        title: "Repair runtime safety",
        status: "ready",
        priority: "p0",
        taskClass: "Safety",
      }),
    );
    const input: WorkflowRepairContinuationInput = {
      attempt: 0,
      failureIds: ["lint"],
      warningIds: [],
      progressKey: "initial-progress",
      previousProgressKey: "initial-progress",
      progressChanged: false,
      noProgressAttempts: 0,
      repairIterations: [],
    };

    const inspection = inspectBuilderContinuationInWorker({
      projectDir,
      workspaceDir: projectDir,
      runDir,
      agentRunDir,
      runId: "run-long-builder",
      taskId: CONTINUATION_TASK_ID,
      priorRunIds: [],
      continuation: input,
    });
    expect(inspection.packet?.boundaryReasons).toContain(
      "higher-priority:task-runtime-safety:p0:Safety",
    );
  });
});
