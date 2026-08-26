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
  unknownCount = 0,
): void {
  writeFileSync(
    join(runsDir, runId, "control-monitor-coverage.json"),
    JSON.stringify({
      schemaVersion: 3,
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
        unavailableCount: 0,
        unknownCount,
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
      unknowns: unknownCount === 0
        ? []
        : [{
            id: "agent-step-stream:interrupted-before-agent-step-events-finalized:1",
            family: "agent-step-stream",
            reason: "interrupted-before-agent-step-events-finalized",
            subject: "build",
            evidenceRefs: [`.kota/runs/${runId}/metadata.json`],
          }],
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

function writePrunedRunReference(
  runsDir: string,
  runId: string,
  workflow: string,
  startedAt: string,
  prunedAt: string,
): void {
  writeFileSync(
    join(runsDir, "pruned-runs.jsonl"),
    `${JSON.stringify({
      artifactType: "workflow-run",
      id: runId,
      prunedAt,
      retained: {
        id: runId,
        workflow,
        status: "success",
        startedAt,
        completedAt: startedAt,
      },
      provenance: {
        workflowName: workflow,
        runId,
        sourceEventIds: [`evtj-${runId}`],
        transformedFrom: [
          { artifactType: "event-envelope", id: `evtj-${runId}` },
        ],
      },
      payloadExpired: true,
    })}\n`,
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

  it("surfaces terminal unknown coverage separately from pending and gaps", () => {
    const runId = "2026-04-28T15-00-00-000Z-builder-unknown";
    writeRun(runsDir, runId, "builder", new Date(NOW - 60 * 60 * 1000).toISOString());
    writeCoverage(runsDir, runId, 0, 0, 1);

    const report = buildControlCoverageReportForWindow({
      runsDir,
      windowEndMs: NOW,
      windowStartMs: NOW - 7 * MS_PER_DAY,
    });

    expect(report).toMatchObject({
      runsWithUnknownCoverage: 1,
      unknownFamilies: 1,
      pendingFamilies: 0,
      totalGaps: 0,
    });
    expect(report.topUnknowns).toEqual([
      expect.objectContaining({
        family: "agent-step-stream",
        reason: "interrupted-before-agent-step-events-finalized",
        count: 1,
      }),
    ]);
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

  it("distinguishes producer-missing coverage from policy-pruned run evidence", () => {
    const missingRun = "2026-04-29T10-00-00-000Z-builder-missing";
    const prunedRun = "2026-04-29T11-00-00-000Z-builder-pruned";
    writeRun(
      runsDir,
      missingRun,
      "builder",
      new Date(NOW - 2 * 60 * 60 * 1000).toISOString(),
    );
    writePrunedRunReference(
      runsDir,
      prunedRun,
      "builder",
      new Date(NOW - 60 * 60 * 1000).toISOString(),
      new Date(NOW - 30 * 60 * 1000).toISOString(),
    );

    const report = buildControlCoverageReportForWindow({
      runsDir,
      windowEndMs: NOW,
      windowStartMs: NOW - 7 * MS_PER_DAY,
    });

    expect(report).toMatchObject({
      artifactCount: 0,
      evidenceGapCount: 2,
      producerMissingEvidenceRefs: 1,
      policyPrunedEvidenceRefs: 1,
    });
    expect(report.evidenceGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "producer-missing",
          reasonCode: "producer-missing",
          evidenceRefs: [
            `.kota/runs/${missingRun}/control-monitor-coverage.json`,
          ],
        }),
        expect.objectContaining({
          kind: "policy-pruned",
          reasonCode: "policy-pruned-payload",
          evidenceRefs: [`.kota/runs/pruned-runs.jsonl#${prunedRun}`],
        }),
      ]),
    );
  });
});
