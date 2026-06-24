import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { SourceFileSizeWarning } from "#modules/autonomy/source-size-check.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import { buildCodeHealthDriftReport } from "./code-health-drift.js";

const NOW = Date.parse("2026-04-29T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const WARNED_FILE = "src/modules/autonomy/report/aggregate.ts";

function task(attrs: Partial<RepoTaskFullRecord> = {}): RepoTaskFullRecord {
  return {
    id: "task-cleanup",
    title: "Split oversized aggregate source-size fallout",
    state: "ready",
    priority: "p3",
    area: "autonomy",
    taskClass: "Meta",
    summary: `Handle ${WARNED_FILE}`,
    updatedAt: new Date(NOW).toISOString(),
    body: `## Problem\n\n${WARNED_FILE} is oversized.\n`,
    dependsOn: [],
    anchor: false,
    ...attrs,
  };
}

function run(id: string, startedAt: number): WorkflowRunMetadata {
  return {
    id,
    workflow: "builder",
    definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
    trigger: { event: "autonomy.queue.available", schemaRef: null, payload: {} },
    startedAt: new Date(startedAt).toISOString(),
    status: "success",
    runDir: `.kota/runs/${id}`,
    steps: [],
  } as WorkflowRunMetadata;
}

function warning(file = WARNED_FILE, changedLines = 12): SourceFileSizeWarning {
  return {
    type: "source-file-size",
    file,
    lines: 420,
    threshold: 300,
    changedLines,
    message: `${file} is oversized`,
  };
}

function writeRunSummary(
  runsDir: string,
  id: string,
  overrides: Partial<{
    taskId: string | null;
    commitSha: string;
    filesChanged: string[];
  }> = {},
): void {
  const dir = join(runsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "run-summary.json"),
    JSON.stringify({
      runId: id,
      workflow: "builder",
      taskId: "task-parent",
      taskTitle: "Parent",
      outcome: "success",
      commitSha: "abc123def4567890",
      commitMessage: "x",
      filesChanged: [WARNED_FILE],
      costUsd: null,
      durationMs: null,
      completedAt: new Date(NOW).toISOString(),
      ...overrides,
    }),
  );
}

function writeSourceReview(
  runsDir: string,
  id: string,
  review: object,
): void {
  writeFileSync(
    join(runsDir, id, "source-file-size-review.json"),
    JSON.stringify(review),
  );
}

describe("buildCodeHealthDriftReport", () => {
  let projectDir: string;
  let runsDir: string;

  beforeEach(() => {
    projectDir = join(tmpdir(), `code-health-drift-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    runsDir = join(projectDir, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("counts a clean builder run with no warnings", () => {
    const runId = "2026-04-28T10-00-00-000Z-builder-clean";
    writeRunSummary(runsDir, runId);
    writeSourceReview(runsDir, runId, {
      outcome: "ok",
      warnings: [],
      message: "No source-size warnings.",
    });

    const report = buildCodeHealthDriftReport({
      tasks: [],
      runs: [run(runId, NOW - DAY)],
      runsDir,
      windowStartMs: NOW - 7 * DAY,
      windowEndMs: NOW,
    });

    expect(report.totalBuilderRuns).toBe(1);
    expect(report.runsWithWarnings).toBe(0);
    expect(report.records).toEqual([]);
  });

  it("links a source-size advisory to an active cleanup task", () => {
    const runId = "2026-04-28T11-00-00-000Z-builder-warning";
    writeRunSummary(runsDir, runId);
    writeSourceReview(runsDir, runId, {
      outcome: "advisory",
      warnings: [warning()],
      message: "Advisory source-size warning",
    });

    const report = buildCodeHealthDriftReport({
      tasks: [task()],
      runs: [run(runId, NOW - DAY)],
      runsDir,
      windowStartMs: NOW - 7 * DAY,
      windowEndMs: NOW,
    });

    expect(report.runsWithWarnings).toBe(1);
    expect(report.byWarningFamily).toEqual([{ key: "source-size", count: 1 }]);
    expect(report.bySurfaceArea).toEqual([{ key: "module:autonomy", count: 1 }]);
    expect(report.records[0]?.cleanupCoverage[0]).toMatchObject({
      kind: "open-cleanup-task",
      taskId: "task-cleanup",
      taskState: "ready",
    });
  });

  it("counts warning-family totals by warning record, not warning run", () => {
    const runId = "2026-04-28T11-30-00-000Z-builder-multi-warning";
    const coreFile = "src/core/workflow/runtime.ts";
    writeRunSummary(runsDir, runId, {
      filesChanged: [WARNED_FILE, coreFile],
    });
    writeSourceReview(runsDir, runId, {
      outcome: "advisory",
      warnings: [warning(WARNED_FILE), warning(coreFile)],
      message: "Advisory source-size warnings",
    });

    const report = buildCodeHealthDriftReport({
      tasks: [],
      runs: [run(runId, NOW - DAY)],
      runsDir,
      windowStartMs: NOW - 7 * DAY,
      windowEndMs: NOW,
    });

    expect(report.runsWithWarnings).toBe(1);
    expect(report.trendBuckets[0]).toMatchObject({
      runsWithWarnings: 1,
      warningRecords: 2,
    });
    expect(report.byWarningFamily).toEqual([{ key: "source-size", count: 2 }]);
    expect(report.bySurfaceArea).toEqual([
      { key: "core:workflow", count: 1 },
      { key: "module:autonomy", count: 1 },
    ]);
  });

  it("surfaces repeated warning paths across current and prior windows", () => {
    const current = "2026-04-28T12-00-00-000Z-builder-current";
    const prior = "2026-04-20T12-00-00-000Z-builder-prior";
    for (const id of [current, prior]) {
      writeRunSummary(runsDir, id);
      writeSourceReview(runsDir, id, {
        outcome: "advisory",
        warnings: [warning()],
        message: "Advisory source-size warning",
      });
    }

    const report = buildCodeHealthDriftReport({
      tasks: [task()],
      runs: [run(current, NOW - DAY), run(prior, NOW - 9 * DAY)],
      runsDir,
      windowStartMs: NOW - 7 * DAY,
      windowEndMs: NOW,
    });

    expect(report.trendBuckets).toMatchObject([
      { bucket: "current", runsWithWarnings: 1, warningRecords: 1 },
      { bucket: "prior", runsWithWarnings: 1, warningRecords: 1 },
    ]);
    expect(report.repeatedSurfaces[0]).toMatchObject({
      file: WARNED_FILE,
      currentWarnings: 1,
      priorWarnings: 1,
      totalWarnings: 2,
    });
    expect(report.repeatedSurfaces[0]?.cleanupCoverage[0]).toMatchObject({
      taskId: "task-cleanup",
    });
  });

  it("treats reducing cleanup exceptions as coverage instead of worse drift", () => {
    const runId = "2026-04-28T13-00-00-000Z-builder-exception";
    writeRunSummary(runsDir, runId);
    writeSourceReview(runsDir, runId, {
      outcome: "exception",
      warnings: [warning(WARNED_FILE, -22)],
      reasons: [],
      exception: {
        kind: "source-size-cleanup",
        taskPath: "data/tasks/done/task-cleanup.md",
        files: [WARNED_FILE],
        reducingFiles: [WARNED_FILE],
      },
      message: "Typed source-size cleanup exception",
    });

    const report = buildCodeHealthDriftReport({
      tasks: [],
      runs: [run(runId, NOW - DAY)],
      runsDir,
      windowStartMs: NOW - 7 * DAY,
      windowEndMs: NOW,
    });

    expect(report.runsWithWarnings).toBe(0);
    expect(report.trendBuckets[0]).toMatchObject({
      cleanupExceptionRuns: 1,
      warningRecords: 0,
    });
    expect(report.records[0]).toMatchObject({ outcome: "cleanup-exception" });
  });

  it("counts malformed and old run artifacts as unsupported without throwing", () => {
    const malformed = "2026-04-28T14-00-00-000Z-builder-malformed";
    writeRunSummary(runsDir, malformed);
    writeFileSync(join(runsDir, malformed, "source-file-size-review.json"), "{bad");

    const malformedClean = "2026-04-28T14-30-00-000Z-builder-malformed-clean";
    writeRunSummary(runsDir, malformedClean);
    writeSourceReview(runsDir, malformedClean, {
      outcome: "ok",
      message: "Missing expected warnings array.",
    });

    const invalidOld = "2026-04-28T15-00-00-000Z-builder-old-invalid";
    mkdirSync(join(runsDir, invalidOld), { recursive: true });
    writeFileSync(
      join(runsDir, invalidOld, "run-summary.json"),
      JSON.stringify({ runId: invalidOld, workflow: "builder", taskId: "task-old" }),
    );

    const unsupportedOld = "2026-04-28T16-00-00-000Z-builder-old-unsupported";
    writeRunSummary(runsDir, unsupportedOld);

    const report = buildCodeHealthDriftReport({
      tasks: [],
      runs: [
        run(malformed, NOW - DAY),
        run(malformedClean, NOW - DAY),
        run(invalidOld, NOW - DAY),
        run(unsupportedOld, NOW - DAY),
      ],
      runsDir,
      windowStartMs: NOW - 7 * DAY,
      windowEndMs: NOW,
    });

    expect(report.unsupportedArtifacts).toBe(4);
    expect(report.records).toEqual([]);
  });
});
