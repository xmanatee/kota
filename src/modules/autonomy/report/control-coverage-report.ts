import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import {
  CONTROL_MONITOR_COVERAGE_ARTIFACT,
  type ControlMonitorCoverageArtifact,
} from "#core/workflow/control-monitor-coverage.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type {
  ControlCoverageEvidenceGap,
  ControlCoverageEvidenceGapKind,
  ControlCoverageEvidenceGapReasonCode,
  ControlCoverageEvidenceGapSummary,
} from "./control-coverage-evidence-gaps.js";

export type {
  ControlCoverageEvidenceGap,
  ControlCoverageEvidenceGapKind,
  ControlCoverageEvidenceGapReasonCode,
  ControlCoverageEvidenceGapSummary,
} from "./control-coverage-evidence-gaps.js";
export {
  policyPrunedControlCoverageEvidenceGapsForWindow,
} from "./control-coverage-evidence-gaps.js";

export type ControlCoverageGapSummary = {
  family: string;
  reason: string;
  severity: "warning" | "error";
  count: number;
  evidenceArtifactPaths: string[];
};

export type ControlMonitorCoverageReport = {
  artifactCount: number;
  runsWithGaps: number;
  totalGaps: number;
  pendingFamilies: number;
  unsupportedFamilies: number;
  blockedFamilies: number;
  warnedFamilies: number;
  evidenceGapCount: number;
  producerMissingEvidenceRefs: number;
  policyPrunedEvidenceRefs: number;
  asyncReviewResponseMs: {
    observations: number;
    min: number | null;
    max: number | null;
    average: number | null;
  };
  evidenceGaps: ControlCoverageEvidenceGapSummary[];
  topGaps: ControlCoverageGapSummary[];
  recentArtifactPaths: string[];
};

type BuildControlCoverageReportOptions = {
  evidenceGaps?: readonly ControlCoverageEvidenceGap[];
};

type ControlGapAccumulator = {
  family: string;
  reason: string;
  severity: "warning" | "error";
  count: number;
  evidenceArtifactPaths: Set<string>;
};

type ControlEvidenceGapAccumulator = {
  kind: ControlCoverageEvidenceGapKind;
  reasonCode: ControlCoverageEvidenceGapReasonCode;
  count: number;
  evidenceRefs: Set<string>;
  summaries: Set<string>;
};

export function emptyControlMonitorCoverageReport(): ControlMonitorCoverageReport {
  return {
    artifactCount: 0,
    runsWithGaps: 0,
    totalGaps: 0,
    pendingFamilies: 0,
    unsupportedFamilies: 0,
    blockedFamilies: 0,
    warnedFamilies: 0,
    evidenceGapCount: 0,
    producerMissingEvidenceRefs: 0,
    policyPrunedEvidenceRefs: 0,
    asyncReviewResponseMs: {
      observations: 0,
      min: null,
      max: null,
      average: null,
    },
    evidenceGaps: [],
    topGaps: [],
    recentArtifactPaths: [],
  };
}

function artifactPath(runsDir: string, runId: string): string {
  return join(runsDir, runId, CONTROL_MONITOR_COVERAGE_ARTIFACT);
}

function artifactRef(runId: string): string {
  return join(".kota", "runs", runId, CONTROL_MONITOR_COVERAGE_ARTIFACT);
}

function recordTiming(
  report: {
    observations: number;
    total: number;
    min: number | null;
    max: number | null;
  },
  artifact: ControlMonitorCoverageArtifact,
): void {
  const timings = artifact.asyncReviewResponseMs;
  if (timings.observations === 0 || timings.average === null) return;
  report.observations += timings.observations;
  report.total += timings.average * timings.observations;
  report.min =
    timings.min === null
      ? report.min
      : report.min === null
        ? timings.min
        : Math.min(report.min, timings.min);
  report.max =
    timings.max === null
      ? report.max
      : report.max === null
        ? timings.max
        : Math.max(report.max, timings.max);
}

function recordEvidenceGap(
  report: ControlMonitorCoverageReport,
  evidenceGaps: Map<string, ControlEvidenceGapAccumulator>,
  gap: ControlCoverageEvidenceGap,
): void {
  report.evidenceGapCount += 1;
  if (gap.kind === "policy-pruned") {
    report.policyPrunedEvidenceRefs += 1;
  } else {
    report.producerMissingEvidenceRefs += 1;
  }
  const key = `${gap.kind}:${gap.reasonCode}`;
  const existing = evidenceGaps.get(key) ?? {
    kind: gap.kind,
    reasonCode: gap.reasonCode,
    count: 0,
    evidenceRefs: new Set<string>(),
    summaries: new Set<string>(),
  };
  existing.count += 1;
  existing.evidenceRefs.add(gap.ref);
  existing.summaries.add(gap.summary);
  evidenceGaps.set(key, existing);
}

function recordGaps(
  topGaps: Map<string, ControlGapAccumulator>,
  artifact: ControlMonitorCoverageArtifact,
  ref: string,
): void {
  for (const gap of artifact.gaps) {
    const key = `${gap.family}:${gap.reason}`;
    const existing = topGaps.get(key) ?? {
      family: gap.family,
      reason: gap.reason,
      severity: gap.severity,
      count: 0,
      evidenceArtifactPaths: new Set<string>(),
    };
    existing.count += 1;
    existing.severity =
      existing.severity === "error" || gap.severity === "error"
        ? "error"
        : "warning";
    existing.evidenceArtifactPaths.add(ref);
    topGaps.set(key, existing);
  }
}

function producerMissingEvidenceGap(run: WorkflowRunMetadata): ControlCoverageEvidenceGap {
  return {
    kind: "producer-missing",
    reasonCode: "producer-missing",
    ref: artifactRef(run.id),
    summary:
      `${run.workflow} ${run.status} at ${run.startedAt}: ` +
      `${CONTROL_MONITOR_COVERAGE_ARTIFACT} was not produced`,
  };
}

export function buildControlCoverageReport(
  runs: readonly WorkflowRunMetadata[],
  runsDir: string,
  options: BuildControlCoverageReportOptions = {},
): ControlMonitorCoverageReport {
  const report = emptyControlMonitorCoverageReport();
  const topGaps = new Map<string, ControlGapAccumulator>();
  const evidenceGaps = new Map<string, ControlEvidenceGapAccumulator>();
  const timing = { observations: 0, total: 0, min: null, max: null };

  for (const gap of options.evidenceGaps ?? []) {
    recordEvidenceGap(report, evidenceGaps, gap);
  }

  for (const run of runs) {
    const artifact = readOptionalJsonFile<ControlMonitorCoverageArtifact>(
      artifactPath(runsDir, run.id),
    );
    if (!artifact) {
      recordEvidenceGap(report, evidenceGaps, producerMissingEvidenceGap(run));
      continue;
    }
    const ref = artifactRef(run.id);
    report.artifactCount += 1;
    report.recentArtifactPaths.push(ref);
    report.totalGaps += artifact.summary.gapCount;
    report.pendingFamilies += artifact.summary.pendingCount;
    report.unsupportedFamilies += artifact.summary.unsupportedCount;
    report.blockedFamilies += artifact.summary.blockedCount;
    report.warnedFamilies += artifact.summary.warnedCount;
    if (artifact.summary.gapCount > 0) report.runsWithGaps += 1;
    recordTiming(timing, artifact);
    recordGaps(topGaps, artifact, ref);
  }

  return {
    ...report,
    asyncReviewResponseMs: {
      observations: timing.observations,
      min: timing.min,
      max: timing.max,
      average:
        timing.observations > 0 ? Math.round(timing.total / timing.observations) : null,
    },
    evidenceGaps: [...evidenceGaps.values()]
      .map((gap) => ({
        kind: gap.kind,
        reasonCode: gap.reasonCode,
        count: gap.count,
        evidenceRefs: [...gap.evidenceRefs].sort().slice(0, 10),
        summaries: [...gap.summaries].sort().slice(0, 5),
      }))
      .sort(
        (a, b) =>
          b.count - a.count ||
          `${a.kind}:${a.reasonCode}`.localeCompare(`${b.kind}:${b.reasonCode}`),
      )
      .slice(0, 10),
    topGaps: [...topGaps.values()]
      .map((gap) => ({
        family: gap.family,
        reason: gap.reason,
        severity: gap.severity,
        count: gap.count,
        evidenceArtifactPaths: [...gap.evidenceArtifactPaths].sort(),
      }))
      .sort((a, b) => b.count - a.count || `${a.family}:${a.reason}`.localeCompare(`${b.family}:${b.reason}`))
      .slice(0, 10),
    recentArtifactPaths: report.recentArtifactPaths.sort().reverse().slice(0, 5),
  };
}
