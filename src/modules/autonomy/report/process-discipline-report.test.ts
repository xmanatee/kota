import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrajectoryDiagnosticCode } from "#core/agent-harness/trajectory-diagnostics.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { RepoTaskFullRecord, RepoTaskState } from "#modules/repo-tasks/repo-tasks-domain.js";
import { buildProcessDisciplineReport } from "./process-discipline-report.js";

const NOW = Date.parse("2026-04-29T12:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function task(
  id: string,
  state: RepoTaskState,
  taskClass: RepoTaskFullRecord["taskClass"],
  area: string,
): RepoTaskFullRecord {
  return {
    id,
    state,
    taskClass,
    area,
    title: id,
    priority: "p2",
    summary: "summary",
    updatedAt: new Date(NOW - MS_PER_DAY).toISOString(),
    body: "## Problem\n\nTest body.\n",
    dependsOn: [],
    anchor: false,
  };
}

function run(
  runId: string,
  workflow: string,
  stepId: string,
  harness: string,
  warningCount: number,
  taskId?: string,
): WorkflowRunMetadata {
  const taskDigest = "0".repeat(64);
  return {
    id: runId,
    workflow,
    definitionPath: `src/modules/autonomy/workflows/${workflow}/workflow.ts`,
    trigger: taskId === undefined
      ? { event: "schedule", payload: {}, schemaRef: null }
      : {
          event: "autonomy.queue.available",
          schemaRef: null,
          payload: {
            taskId,
            taskPath: `data/tasks/ready/${taskId}.md`,
            taskState: "ready",
            taskUpdatedAt: new Date(NOW - MS_PER_DAY).toISOString(),
            taskDigest,
            idempotencyKey: `builder:${taskId}:${taskDigest}`,
            title: taskId,
          },
        },
    runDir: `.kota/runs/${runId}`,
    startedAt: new Date(NOW - MS_PER_DAY).toISOString(),
    completedAt: new Date(NOW - MS_PER_DAY + 1000).toISOString(),
    status: "success",
    durationMs: 1000,
    steps: [
      {
        id: stepId,
        type: "agent",
        status: "success",
        startedAt: new Date(NOW - MS_PER_DAY).toISOString(),
        completedAt: new Date(NOW - MS_PER_DAY + 1000).toISOString(),
        durationMs: 1000,
        harness,
        trajectoryDiagnostics: {
          artifactPath: `.kota/runs/${runId}/steps/${stepId}.trajectory-diagnostics.json`,
          warningCount,
          unsupportedTrajectoryCount: 0,
          missingStreamingFramesCount: 0,
          missingFinalVerificationAfterEditCount: warningCount,
          repeatedIdenticalFailingCommandCount: 0,
          editAfterSuccessfulVerificationCount: 0,
          longPreambleWithoutTaskTouchCount: 0,
        },
      },
    ],
  };
}

function writeDiagnostics(
  runsDir: string,
  runId: string,
  stepId: string,
  codes: readonly TrajectoryDiagnosticCode[],
  status: "supported" | "unsupported" = "supported",
): void {
  const stepsDir = join(runsDir, runId, "steps");
  mkdirSync(stepsDir, { recursive: true });
  writeFileSync(
    join(stepsDir, `${stepId}.trajectory-diagnostics.json`),
    JSON.stringify({
      version: 1,
      status,
      emitsAgentMessageStream: status === "supported",
      counts: {
        warningCount: codes.length,
        unsupportedTrajectoryCount: codes.filter((code) => code === "unsupported_trajectory").length,
        missingStreamingFramesCount: codes.filter((code) => code === "missing_streaming_frames").length,
        missingFinalVerificationAfterEditCount: codes.filter((code) => code === "missing_final_verification_after_edit").length,
        repeatedIdenticalFailingCommandCount: codes.filter((code) => code === "repeated_identical_failing_command").length,
        editAfterSuccessfulVerificationCount: codes.filter((code) => code === "edit_after_successful_verification").length,
        longPreambleWithoutTaskTouchCount: codes.filter((code) => code === "long_preamble_without_task_touch").length,
      },
      diagnostics: codes.map((code) => ({
        code,
        severity: "warning",
        summary: `summary:${code}`,
        frameIndexes: [4],
        details: [`detail:${code}`],
      })),
    }),
  );
}

describe("buildProcessDisciplineReport", () => {
  let projectDir: string;
  let runsDir: string;

  beforeEach(() => {
    projectDir = join(tmpdir(), `process-discipline-report-${Date.now()}`);
    runsDir = join(projectDir, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("projects workflow agent trajectory diagnostics into grouped discipline records", () => {
    const runId = "2026-04-28T12-30-00-000Z-builder-discipline";
    const taskById = new Map([
      ["task-discipline", task("task-discipline", "done", "Safety", "autonomy")],
    ]);
    writeDiagnostics(runsDir, runId, "build", [
      "missing_final_verification_after_edit",
    ]);

    const report = buildProcessDisciplineReport({
      runs: [run(runId, "builder", "build", "codex", 1, "task-discipline")],
      runsDir,
      taskById,
    });

    expect(report.totalRecords).toBe(1);
    expect(report.records[0]).toMatchObject({
      runId,
      workflow: "builder",
      stepId: "build",
      harness: "codex",
      taskId: "task-discipline",
      taskClass: "Safety",
      taskArea: "autonomy",
      processDiscipline: {
        aggregate: { score: 75, grade: "caution", missingEvidenceDimensions: 1 },
      },
    });
    expect(
      report.records[0]?.processDiscipline.dimensions.find(
        (entry) => entry.dimension === "verification-coverage",
      ),
    ).toMatchObject({
      status: "supported",
      score: 0,
      reasons: ["missing_final_verification_after_edit"],
    });
    expect(report.groups).toContainEqual(
      expect.objectContaining({
        dimension: "workflow",
        value: "builder",
        averageScore: 75,
        weakSample: true,
        missingEvidenceDimensions: 1,
      }),
    );
    expect(JSON.stringify(report)).not.toMatch(/cost|throughput|SECRET_TOKEN|full diff/i);
  });

  it("reports blocked abstention and unsupported stream evidence honestly", () => {
    const blockedRunId = "2026-04-28T12-40-00-000Z-builder-blocked";
    const unsupportedRunId = "2026-04-28T12-45-00-000Z-explorer-unsupported";
    const taskById = new Map([
      [
        "task-blocked-discipline",
        task("task-blocked-discipline", "blocked", "Safety", "security"),
      ],
    ]);
    writeDiagnostics(runsDir, blockedRunId, "build", []);
    writeDiagnostics(
      runsDir,
      unsupportedRunId,
      "explore",
      ["unsupported_trajectory"],
      "unsupported",
    );

    const report = buildProcessDisciplineReport({
      runs: [
        run(
          blockedRunId,
          "builder",
          "build",
          "codex",
          0,
          "task-blocked-discipline",
        ),
        run(unsupportedRunId, "explorer", "explore", "thin", 1),
      ],
      runsDir,
      taskById,
    });

    const blockedRecord = report.records.find((record) => record.runId === blockedRunId);
    const unsupportedRecord = report.records.find(
      (record) => record.runId === unsupportedRunId,
    );
    expect(blockedRecord?.processDiscipline.aggregate).toMatchObject({
      score: 100,
      grade: "excellent",
      missingEvidenceDimensions: 0,
    });
    expect(
      blockedRecord?.processDiscipline.dimensions.find(
        (entry) => entry.dimension === "abstention-quality",
      ),
    ).toMatchObject({ status: "supported", score: 20 });
    expect(unsupportedRecord?.processDiscipline.aggregate).toMatchObject({
      score: null,
      grade: "unsupported",
      unsupportedDimensions: 5,
    });
    expect(report.groups).toContainEqual(
      expect.objectContaining({
        dimension: "harness",
        value: "thin",
        averageScore: null,
        unsupportedDimensions: 5,
      }),
    );
  });
});
