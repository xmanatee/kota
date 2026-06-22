import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildControlCoverageReportForWindow } from "./control-coverage-report-window.js";

const NOW = Date.parse("2026-04-29T12:00:00.000Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function writeRun(
  runsDir: string,
  id: string,
  workflow: string,
  startedAt: string,
): void {
  const dir = join(runsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "metadata.json"),
    JSON.stringify({
      id,
      workflow,
      definitionPath: `src/modules/autonomy/workflows/${workflow}/workflow.ts`,
      trigger: { event: "schedule", payload: {} },
      runDir: `.kota/runs/${id}`,
      startedAt,
      completedAt: startedAt,
      status: "success",
      durationMs: 1000,
      steps: [],
    }),
  );
}

function writeCoverage(
  runsDir: string,
  runId: string,
  gapCount: number,
  averageMs: number,
): void {
  writeFileSync(
    join(runsDir, runId, "control-monitor-coverage.json"),
    JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date(NOW).toISOString(),
      artifactPath: `.kota/runs/${runId}/control-monitor-coverage.json`,
      run: {
        id: runId,
        workflow: "builder",
        triggerEvent: "autonomy.queue.available",
        status: "success",
        startedAt: new Date(NOW).toISOString(),
        completedAt: new Date(NOW).toISOString(),
        headSha: "abc",
      },
      monitoredSurfaceCounts: {
        agentSteps: 1,
        toolCalls: 1,
        externalPayloadIngests: 1,
        approvalRequests: 0,
        ownerQuestionWaits: 0,
        daemonHostControlDenials: 0,
        runtimeProbes: 0,
        postRunReviewLinks: 1,
      },
      summary: {
        numerator: 3,
        denominator: 5,
        gapCount,
        unsupportedCount: gapCount === 0 ? 1 : 0,
        pendingCount: gapCount,
        blockedCount: 0,
        warnedCount: gapCount === 0 ? 2 : 0,
      },
      families: [],
      gaps: gapCount === 0
        ? []
        : [
            {
              id: "injection-defense:external-payload-unscreened:1",
              family: "injection-defense",
              severity: "error",
              reason: "external-payload-unscreened",
              subject: "1 external payload(s)",
              evidenceRefs: [`.kota/runs/${runId}/metadata.json`],
            },
          ],
      asyncReviewResponseMs: {
        observations: 1,
        min: averageMs,
        max: averageMs,
        average: averageMs,
      },
    }),
    "utf-8",
  );
}

describe("control coverage report aggregation", () => {
  let projectDir: string;
  let runsDir: string;

  beforeEach(() => {
    projectDir = join(
      tmpdir(),
      `kota-control-coverage-report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    runsDir = join(projectDir, ".kota", "runs");
    mkdirSync(runsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("surfaces coverage artifact paths, gap counts, and response timing", () => {
    const runA = "2026-04-28T13-00-00-000Z-builder-control-a";
    const runB = "2026-04-28T14-00-00-000Z-builder-control-b";
    writeRun(runsDir, runA, "builder", new Date(NOW - 2 * 60 * 60 * 1000).toISOString());
    writeRun(runsDir, runB, "builder", new Date(NOW - 60 * 60 * 1000).toISOString());
    writeCoverage(runsDir, runA, 1, 5000);
    writeCoverage(runsDir, runB, 0, 7000);

    const report = buildControlCoverageReportForWindow({
      runsDir,
      windowEndMs: NOW,
      windowStartMs: NOW - 7 * MS_PER_DAY,
    });

    expect(report).toMatchObject({
      artifactCount: 2,
      runsWithGaps: 1,
      totalGaps: 1,
      pendingFamilies: 1,
      unsupportedFamilies: 1,
      warnedFamilies: 2,
      asyncReviewResponseMs: {
        observations: 2,
        min: 5000,
        max: 7000,
        average: 6000,
      },
    });
    expect(report.topGaps[0]).toMatchObject({
      family: "injection-defense",
      reason: "external-payload-unscreened",
      severity: "error",
      count: 1,
    });
    expect(report.recentArtifactPaths).toContain(
      `.kota/runs/${runB}/control-monitor-coverage.json`,
    );
  });
});
