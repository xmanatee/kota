import { join } from "node:path";
import type {
  HarnessParityMatrixGroupAggregate,
  HarnessParityMatrixRow,
  HarnessParityMatrixShadowComparison,
} from "./client.js";
import type { MatrixGroup } from "./model-matrix-aggregate.js";
import { compatibilityChecks } from "./model-matrix-shadow-checks.js";

function averageDuration(rows: readonly HarnessParityMatrixRow[]): number | null {
  const runnable = rows.filter((row) => row.status !== "skipped");
  if (runnable.length === 0) return null;
  return runnable.reduce((sum, row) => sum + row.durationMs, 0) / runnable.length;
}

function totalCost(rows: readonly HarnessParityMatrixRow[]): number | null {
  let total = 0;
  let observed = false;
  for (const row of rows) {
    if (row.estimatedCostUsd === null) continue;
    total += row.estimatedCostUsd;
    observed = true;
  }
  return observed ? total : null;
}

function representativeStatus(
  rows: readonly HarnessParityMatrixRow[],
): "passed" | "failed" | "error" | "skipped" {
  if (rows.some((row) => row.status === "error")) return "error";
  if (rows.some((row) => row.status === "failed")) return "failed";
  if (rows.some((row) => row.status === "passed")) return "passed";
  return "skipped";
}

function sharedFiles(a: readonly string[], b: readonly string[]): string[] {
  const right = new Set(b);
  return a.filter((entry) => right.has(entry)).sort();
}

function traceSummaryPath(row: HarnessParityMatrixRow | undefined): string | null {
  return row?.artifactDir ? join(row.artifactDir, "trace-summary.md") : null;
}

function compareShadowRows(
  baselineGroup: MatrixGroup,
  candidateGroup: MatrixGroup,
  baselineAggregate: HarnessParityMatrixGroupAggregate,
  candidateAggregate: HarnessParityMatrixGroupAggregate,
): HarnessParityMatrixShadowComparison {
  const baselineFirst = baselineGroup.rows[0]!;
  const candidateFirst = candidateGroup.rows[0]!;
  const baselineDuration = averageDuration(baselineGroup.rows);
  const candidateDuration = averageDuration(candidateGroup.rows);
  const baselineCost = totalCost(baselineGroup.rows);
  const candidateCost = totalCost(candidateGroup.rows);
  const baselineFiles = [
    ...new Set(baselineGroup.rows.flatMap((row) => row.changedFiles)),
  ].sort();
  const candidateFiles = [
    ...new Set(candidateGroup.rows.flatMap((row) => row.changedFiles)),
  ].sort();
  const baselineTraceSummaryPath = traceSummaryPath(
    baselineGroup.rows.find((row) => row.artifactDir !== undefined),
  );
  const candidateTraceSummaryPath = traceSummaryPath(
    candidateGroup.rows.find((row) => row.artifactDir !== undefined),
  );
  const checks = compatibilityChecks({
    baselineGroup,
    candidateGroup,
    baselineAggregate,
    candidateAggregate,
    baselineDuration,
    candidateDuration,
    baselineCost,
    candidateCost,
    baselineTraceSummaryPath,
    candidateTraceSummaryPath,
  });
  const compatible = checks.every((entry) => entry.passed);
  const failedChecks = checks
    .filter((entry) => !entry.passed)
    .map((entry) => entry.name);

  return {
    baseline: {
      targetKind: baselineFirst.targetKind,
      label: baselineFirst.label,
      model: baselineFirst.model,
      harnessName: baselineFirst.harnessName,
      scenarioId: baselineFirst.scenarioId,
    },
    candidate: {
      targetKind: candidateFirst.targetKind,
      label: candidateFirst.label,
      model: candidateFirst.model,
      harnessName: candidateFirst.harnessName,
      scenarioId: candidateFirst.scenarioId,
    },
    compatible,
    compatibilityReason: compatible
      ? "all shadow comparison compatibility checks passed"
      : `failed compatibility checks: ${failedChecks.join(", ")}`,
    compatibilityChecks: checks,
    workspaceIsolation: "cloned-scenario-working-tree",
    passAtKDelta:
      baselineAggregate.passAtK === null || candidateAggregate.passAtK === null
        ? null
        : candidateAggregate.passAtK - baselineAggregate.passAtK,
    passHatKDelta:
      baselineAggregate.passHatK === null ||
      candidateAggregate.passHatK === null
        ? null
        : candidateAggregate.passHatK - baselineAggregate.passHatK,
    latencyDeltaMs:
      baselineDuration === null || candidateDuration === null
        ? null
        : candidateDuration - baselineDuration,
    costDeltaUsd:
      baselineCost === null || candidateCost === null
        ? null
        : candidateCost - baselineCost,
    diff: {
      baselineChangedFiles: baselineFiles,
      candidateChangedFiles: candidateFiles,
      sharedChangedFiles: sharedFiles(baselineFiles, candidateFiles),
    },
    tests: {
      command: baselineFirst.verification?.command ?? null,
      baselinePassed: baselineFirst.verification?.passed ?? null,
      candidatePassed: candidateFirst.verification?.passed ?? null,
    },
    failures: {
      baselineStatus: representativeStatus(baselineGroup.rows),
      candidateStatus: representativeStatus(candidateGroup.rows),
    },
    planEvidence: {
      baselineTraceSummaryPath,
      candidateTraceSummaryPath,
    },
  };
}

export function buildShadowComparisons(
  matrixGroups: readonly MatrixGroup[],
  aggregates: readonly HarnessParityMatrixGroupAggregate[],
): HarnessParityMatrixShadowComparison[] {
  const aggregateByKey = new Map(
    matrixGroups.map((group, index) => [group.key, aggregates[index]!]),
  );
  const baselines = matrixGroups.filter(
    (group) => group.rows[0]?.role === "baseline",
  );
  const candidates = matrixGroups.filter(
    (group) => group.rows[0]?.role === "candidate",
  );
  const comparisons: HarnessParityMatrixShadowComparison[] = [];
  for (const candidate of candidates) {
    const candidateFirst = candidate.rows[0]!;
    const baseline = baselines.find((group) => {
      const baselineFirst = group.rows[0]!;
      return (
        baselineFirst.targetKind === candidateFirst.targetKind &&
        baselineFirst.harnessName === candidateFirst.harnessName &&
        baselineFirst.scenarioId === candidateFirst.scenarioId
      );
    });
    if (!baseline) continue;
    comparisons.push(
      compareShadowRows(
        baseline,
        candidate,
        aggregateByKey.get(baseline.key)!,
        aggregateByKey.get(candidate.key)!,
      ),
    );
  }
  return comparisons;
}
