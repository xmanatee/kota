import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DIFF_SUMMARY_CONSISTENCY_ARTIFACT,
  type DiffSummaryConsistencyRecord,
} from "#modules/autonomy/diff-summary-consistency.js";
import { aggregateAutonomyReport } from "./aggregate.js";
import { renderReport, section } from "./render-test-helpers.js";

const NOW = Date.parse("2026-06-24T12:00:00.000Z");

function writeTask(workspaceRoot: string): void {
  const dir = join(workspaceRoot, "data", "tasks", "done");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "task-eval-harness.md"),
    [
      "---",
      "id: task-eval-harness",
      "title: Fix eval-harness recorder guard",
      "status: done",
      "priority: p2",
      "area: modules",
      "summary: Fix eval-harness recorder guard.",
      "created_at: 2026-06-24T00:00:00.000Z",
      "updated_at: 2026-06-24T10:00:00.000Z",
      "---",
      "",
      "## Problem",
      "",
      "Test task.",
      "",
    ].join("\n"),
    "utf-8",
  );
}

function writeRun(runsDir: string, id: string): string {
  const runDir = join(runsDir, id);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "metadata.json"),
    JSON.stringify({
      id,
      workflow: "builder",
      definitionPath: "src/modules/autonomy/workflows/builder/workflow.ts",
      startedAt: "2026-06-24T11:00:00.000Z",
      completedAt: "2026-06-24T11:10:00.000Z",
      status: "success",
      trigger: { event: "autonomy.queue.available", payload: {} },
      runDir: `.kota/runs/${id}`,
      steps: [],
    }),
    "utf-8",
  );
  return runDir;
}

function writeDiagnostic(runDir: string, record: DiffSummaryConsistencyRecord): void {
  writeFileSync(
    join(runDir, DIFF_SUMMARY_CONSISTENCY_ARTIFACT),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf-8",
  );
}

function mismatchRecord(runId: string): DiffSummaryConsistencyRecord {
  return {
    version: 1,
    runId,
    taskId: "task-eval-harness",
    taskTitle: "Fix eval-harness recorder guard",
    commitSha: "abc123def456",
    declared: {
      commitSubject: "Fix eval-harness recorder guard SECRET_TOKEN=abc cost $99",
      commitMessageFile: "Raw prompt and tool payload should stay out",
      taskTitle: "Fix eval-harness recorder guard",
      taskSummary: "Owner-visible summary should not be copied into report output.",
    },
    facts: {
      changedFileCount: 4,
      changedFiles: [
        "src/modules/eval-harness/recorder.ts",
        "src/modules/autonomy/report/render.ts",
      ],
      truncatedChangedFileCount: 0,
      topLevelAreas: ["src"],
      moduleNames: ["autonomy", "eval-harness"],
      fileBuckets: [{ bucket: "production", count: 4 }],
      addedFileCount: 0,
      deletedFileCount: 0,
      renamedFileCount: 0,
      modifiedFileCount: 4,
      taskFileCount: 0,
      productionFileCount: 4,
      testFileCount: 0,
      docFileCount: 0,
      generatedOrBaselineChanged: false,
      largeDiff: false,
      taskMovedToDone: true,
    },
    mismatches: [
      {
        category: "broad-source-churn-omitted",
        severity: "advisory",
        message: "Declared summary is narrower than the changed production modules.",
        evidence: {
          mentionedModules: ["eval-harness"],
          touchedModules: ["autonomy", "eval-harness"],
          changedFileCount: 4,
        },
      },
    ],
    missingData: ["commit-message-file"],
  };
}

describe("diff-summary consistency report", () => {
  let workspaceRoot: string;
  let runsDir: string;

  beforeEach(() => {
    workspaceRoot = join(
      tmpdir(),
      `kota-diff-summary-report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    runsDir = join(workspaceRoot, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
    writeTask(workspaceRoot);
  });

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("aggregates mismatch categories, missing metadata, and sanitized examples", () => {
    const runId = "2026-06-24T11-00-00-000Z-builder-diff";
    const runDir = writeRun(runsDir, runId);
    writeDiagnostic(runDir, mismatchRecord(runId));

    const report = aggregateAutonomyReport({
      workspaceRoot,
      runsDir,
      windowEndMs: NOW,
      windowDays: 1,
    });

    expect(report.diffSummaryConsistency).toMatchObject({
      totalBuilderRuns: 1,
      recordedRuns: 1,
      runsWithMismatches: 1,
      totalMismatches: 1,
      byCategory: [{ category: "broad-source-churn-omitted", count: 1 }],
      missingData: [{ kind: "commit-message-file", count: 1 }],
    });
    expect(report.diffSummaryConsistency.examples[0]).toMatchObject({
      runId,
      taskId: "task-eval-harness",
      categories: ["broad-source-churn-omitted"],
      changedFileCount: 4,
      moduleNames: ["autonomy", "eval-harness"],
    });

    const text = renderReport(report);
    const diffSection = section(text, "Diff-summary consistency", "Owner interventions");
    expect(diffSection).toContain("broad-source-churn-omitted");
    expect(diffSection).toContain(runId);
    expect(diffSection).toContain("task-eval-harness");
    expect(diffSection).not.toContain("SECRET_TOKEN");
    expect(diffSection).not.toContain("Raw prompt");
    expect(diffSection).not.toMatch(/\$99|cost/i);
  });

  it("reports older builder runs missing the diagnostic artifact", () => {
    writeRun(runsDir, "2026-06-24T11-30-00-000Z-builder-older");

    const report = aggregateAutonomyReport({
      workspaceRoot,
      runsDir,
      windowEndMs: NOW,
      windowDays: 1,
    });

    expect(report.diffSummaryConsistency).toMatchObject({
      totalBuilderRuns: 1,
      recordedRuns: 0,
      runsWithMismatches: 0,
      missingData: [{ kind: "artifact", count: 1 }],
    });
  });
});
