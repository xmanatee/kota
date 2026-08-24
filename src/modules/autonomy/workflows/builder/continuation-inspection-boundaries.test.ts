import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowRepairContinuationInput } from "#core/workflow/run-types.js";
import { inspectBuilderContinuationInWorker } from "./continuation-inspection.js";
import {
  CONTINUATION_TASK_ID,
  continuationTaskContent,
  continuationTrajectory,
  createContinuationInspectionFixture,
} from "./continuation-inspection.test-helpers.js";

describe("builder continuation boundary stability", () => {
  let projectDir: string;
  let runDir: string;
  let agentRunDir: string;

  beforeEach(() => {
    ({ projectDir, runDir, agentRunDir } = createContinuationInspectionFixture());
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("treats an unchanged judged evidence boundary as a no-op", () => {
    const input = continuationTrajectory([["lint"], ["lint"], ["lint"]], ["lint"]);
    const first = inspectBuilderContinuationInWorker({
      projectDir,
      workspaceDir: projectDir,
      runDir,
      agentRunDir,
      runId: "run-long-builder",
      taskId: CONTINUATION_TASK_ID,
      priorRunIds: [],
      continuation: input,
    });
    expect(first.packet).not.toBeNull();
    writeFileSync(
      first.artifactPath,
      JSON.stringify({
        schemaVersion: 1,
        runId: "run-long-builder",
        latestPacket: first.packet,
        decisions: [{
          decision: "continue",
          evidenceKey: first.packet!.boundaryKey,
          summary: "Converging enough to continue.",
          nextAction: "Finish the focused repair.",
          packet: first.packet,
        }],
      }),
    );

    const continuationRunDir = join(projectDir, ".kota/runs/run-long-builder-continuation");
    mkdirSync(continuationRunDir, { recursive: true });
    const repeated = inspectBuilderContinuationInWorker({
      projectDir,
      workspaceDir: projectDir,
      runDir: continuationRunDir,
      agentRunDir,
      runId: "run-long-builder-continuation",
      taskId: CONTINUATION_TASK_ID,
      priorRunIds: ["run-long-builder"],
      continuation: input,
    });
    expect(repeated.packet).toBeNull();
    expect(JSON.parse(readFileSync(first.artifactPath, "utf8")).decisions).toHaveLength(1);
  });

  it("does not review a stable semantic boundary on irrelevant churn", () => {
    const input = continuationTrajectory([["lint"], ["lint"], ["lint"]], ["lint"]);
    const first = inspectBuilderContinuationInWorker({
      projectDir,
      workspaceDir: projectDir,
      runDir,
      agentRunDir,
      runId: "run-long-builder",
      taskId: CONTINUATION_TASK_ID,
      priorRunIds: [],
      continuation: input,
    });
    if (first.packet === null) throw new Error("baseline boundary is missing");
    writeFileSync(
      first.artifactPath,
      JSON.stringify({
        schemaVersion: 1,
        runId: "run-long-builder",
        latestPacket: first.packet,
        decisions: [{
          decision: "continue",
          evidenceKey: first.packet.boundaryKey,
          summary: "Continue from the first changing boundary.",
          nextAction: "Re-evaluate materially new progress.",
          packet: first.packet,
        }],
      }),
    );
    const inspectNext = (
      runId: string,
      continuation: WorkflowRepairContinuationInput = input,
    ) => {
      const nextRunDir = join(projectDir, ".kota/runs", runId);
      mkdirSync(nextRunDir, { recursive: true });
      return inspectBuilderContinuationInWorker({
        projectDir,
        workspaceDir: projectDir,
        runDir: nextRunDir,
        agentRunDir,
        runId,
        taskId: CONTINUATION_TASK_ID,
        priorRunIds: ["run-long-builder"],
        continuation,
      }).packet;
    };
    expect(inspectNext("run-progress-advanced", {
      ...input,
      attempt: 4,
      progressKey: "next-progress",
      previousProgressKey: input.progressKey,
      repairIterations: [
        ...input.repairIterations,
        { attempt: 4, failureIds: ["lint"] },
      ],
    })).toBeNull();

    writeFileSync(join(projectDir, "src/work.ts"), "export const work = 3;\n");
    expect(inspectNext("run-diff-advanced")).toBeNull();
    writeFileSync(join(projectDir, "src/work.ts"), "export const work = 2;\n");

    const queueTaskPath = join(projectDir, "data/tasks/ready/task-later.md");
    writeFileSync(queueTaskPath, continuationTaskContent({
      id: "task-later",
      title: "Later work",
      status: "ready",
      priority: "p2",
      taskClass: "Meta",
    }));
    expect(inspectNext("run-queue-advanced")).toBeNull();
    rmSync(queueTaskPath);

    writeFileSync(join(agentRunDir, "success-criteria-verified.txt"), "1. Verified.\n");
    expect(inspectNext("run-verification-advanced")).toBeNull();

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
    const priorityBoundary = inspectNext("run-priority-advanced");
    expect(priorityBoundary?.boundaryKey).not.toBe(first.packet.boundaryKey);
    expect(priorityBoundary?.boundaryReasons).toContain(
      "higher-priority:task-runtime-safety:p0:Safety",
    );
  });
});
