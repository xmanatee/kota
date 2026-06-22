import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import {
  CONTROL_MONITOR_COVERAGE_ARTIFACT,
  type ControlMonitorCoverageArtifact,
} from "#core/workflow/control-monitor-coverage.js";
import type { AutonomyHealthEvidenceRef } from "#modules/autonomy/health-signal.js";
import {
  addPattern,
  type PatternInput,
  type RuntimeHealthAuditContext,
} from "./runtime-health-audit-model.js";

type WorkflowHistoryRunLike = {
  id: string;
  workflow: string;
  status: string;
  startedAt: string;
};

type ControlCoverageGapObservation = {
  run: WorkflowHistoryRunLike;
  family: string;
  reason: string;
  severity: "warning" | "error";
  artifactRef: string;
  gapCount: number;
};

function artifactRef(runId: string): string {
  return join(".kota", "runs", runId, CONTROL_MONITOR_COVERAGE_ARTIFACT);
}

function readArtifact(
  ctx: RuntimeHealthAuditContext,
  run: WorkflowHistoryRunLike,
): ControlMonitorCoverageArtifact | null {
  return readOptionalJsonFile<ControlMonitorCoverageArtifact>(
    join(ctx.projectDir, ".kota", "runs", run.id, CONTROL_MONITOR_COVERAGE_ARTIFACT),
  );
}

function evidenceRefs(
  observations: readonly ControlCoverageGapObservation[],
): AutonomyHealthEvidenceRef[] {
  return observations.map((observation) => ({
    kind: "artifact",
    ref: observation.artifactRef,
    summary:
      `${observation.run.workflow} ${observation.run.status} at ` +
      `${observation.run.startedAt}: ${observation.gapCount} ` +
      `${observation.family}/${observation.reason} gap(s)`,
  }));
}

function pattern(
  observations: readonly ControlCoverageGapObservation[],
): PatternInput {
  const first = observations[0]!;
  const count = observations.length;
  const severity = observations.some((observation) => observation.severity === "error")
    ? "error"
    : "warning";
  return {
    dedupeKey: `control-coverage:${first.family}:${first.reason}`,
    category: "local-code",
    severity,
    actionability: "local-code",
    labels: [
      "control-coverage",
      "local-code",
      "runtime",
      first.family,
      first.reason,
    ],
    summary:
      `Control monitor coverage gap ${first.family}/${first.reason} recurred ` +
      `in ${count} recent run(s).`,
    source: { kind: "workflow", id: "control-monitor-coverage" },
    observationCount: count,
    evidenceRefs: evidenceRefs(observations),
  };
}

function observationsFor(
  run: WorkflowHistoryRunLike,
  artifact: ControlMonitorCoverageArtifact,
): ControlCoverageGapObservation[] {
  const byKey = new Map<
    string,
    {
      family: string;
      reason: string;
      severity: "warning" | "error";
      gapCount: number;
    }
  >();
  for (const gap of artifact.gaps) {
    const key = `${gap.family}\0${gap.reason}`;
    const existing = byKey.get(key) ?? {
      family: gap.family,
      reason: gap.reason,
      severity: gap.severity,
      gapCount: 0,
    };
    existing.gapCount += 1;
    existing.severity =
      existing.severity === "error" || gap.severity === "error"
        ? "error"
        : "warning";
    byKey.set(key, existing);
  }
  return [...byKey.values()].map((gap) => ({
    run,
    family: gap.family,
    reason: gap.reason,
    severity: gap.severity,
    artifactRef: artifactRef(run.id),
    gapCount: gap.gapCount,
  }));
}

export function scanControlCoverageGaps(
  ctx: RuntimeHealthAuditContext,
  runs: readonly WorkflowHistoryRunLike[],
): void {
  const byFamilyReason = new Map<string, ControlCoverageGapObservation[]>();
  for (const run of runs) {
    const artifact = readArtifact(ctx, run);
    if (!artifact) continue;
    ctx.inspected.controlCoverageArtifacts += 1;
    if (artifact.gaps.length > 0) ctx.inspected.controlCoverageGapRuns += 1;
    for (const observation of observationsFor(run, artifact)) {
      const key = `${observation.family}\0${observation.reason}`;
      const existing = byFamilyReason.get(key) ?? [];
      existing.push(observation);
      byFamilyReason.set(key, existing);
    }
  }

  for (const observations of byFamilyReason.values()) {
    if (observations.length < ctx.interruptedRunMinCount) continue;
    addPattern(ctx, pattern(observations));
  }
}
