import { createHash } from "node:crypto";
import type {
  TrajectoryDiagnostic,
  TrajectoryDiagnosticCode,
} from "#core/agent-harness/index.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { loadRunsInWindow } from "#modules/workflow-ops/runs/workflow-history.js";
import {
  isEscalatableDiagnostic,
  isEscalatableDiagnosticArtifact,
  listStepTrajectoryArtifacts,
  readTrajectoryDiagnosticsArtifact,
  repoRelativeTrajectoryArtifactPath,
  stepIdFromArtifactPath,
} from "./trajectory-diagnostic-artifacts.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const DEFAULT_TRAJECTORY_DIAGNOSTIC_WINDOW_MS = 7 * MS_PER_DAY;
export const DEFAULT_TRAJECTORY_DIAGNOSTIC_PATTERN_RUNS = 3;
export const DEFAULT_TRAJECTORY_DIAGNOSTIC_REPORT_LIMIT = 5;

const MAX_DETAIL_LINES = 6;
const MAX_DETAIL_LENGTH = 180;

export type TrajectoryDiagnosticPatternConfig = {
  nowMs?: number;
  windowMs?: number;
  thresholdRuns?: number;
};

export type TrajectoryDiagnosticPattern = {
  workflow: string;
  stepId: string;
  code: TrajectoryDiagnosticCode;
  detailFingerprint: string;
  fingerprint: string;
  evidenceFingerprint: string;
  runIds: string[];
  runCount: number;
  artifactPaths: string[];
  windowStart: string;
  windowEnd: string;
  summary: string;
  details: string[];
  reason: string;
};

type RunWithTime = {
  run: WorkflowRunMetadata;
  timeMs: number;
  timeIso: string;
};

type DiagnosticObservation = {
  workflow: string;
  stepId: string;
  code: TrajectoryDiagnosticCode;
  detailFingerprint: string;
  fingerprint: string;
  runId: string;
  timeMs: number;
  timeIso: string;
  artifactPath: string;
  summary: string;
  details: string[];
};

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function shortHash(value: string): string {
  return stableHash(value).slice(0, 12);
}

function runTime(run: WorkflowRunMetadata): RunWithTime | null {
  const raw = run.completedAt ?? run.startedAt;
  const timeMs = Date.parse(raw);
  if (!Number.isFinite(timeMs)) return null;
  return { run, timeMs, timeIso: new Date(timeMs).toISOString() };
}

function sortRunsNewestFirst(runs: WorkflowRunMetadata[]): RunWithTime[] {
  return runs
    .map(runTime)
    .filter((entry): entry is RunWithTime => entry !== null)
    .sort((a, b) => b.timeMs - a.timeMs || b.run.id.localeCompare(a.run.id));
}

function normalizeConfig(
  config: TrajectoryDiagnosticPatternConfig | undefined,
): Required<TrajectoryDiagnosticPatternConfig> {
  return {
    nowMs: config?.nowMs ?? Date.now(),
    windowMs: config?.windowMs ?? DEFAULT_TRAJECTORY_DIAGNOSTIC_WINDOW_MS,
    thresholdRuns:
      config?.thresholdRuns ?? DEFAULT_TRAJECTORY_DIAGNOSTIC_PATTERN_RUNS,
  };
}

function truncateSingleLine(value: string, max = MAX_DETAIL_LENGTH): string {
  const single = value.replace(/\s+/g, " ").trim();
  if (single.length <= max) return single;
  return `${single.slice(0, max - 3)}...`;
}

function boundedDiagnosticDetails(diagnostic: TrajectoryDiagnostic): string[] {
  return diagnostic.details
    .slice(0, MAX_DETAIL_LINES)
    .map((detail) => truncateSingleLine(detail));
}

function diagnosticDetailFingerprint(diagnostic: TrajectoryDiagnostic): string {
  return shortHash(
    [
      truncateSingleLine(diagnostic.summary),
      ...boundedDiagnosticDetails(diagnostic),
    ].join("\0"),
  );
}

function patternFingerprint(args: {
  workflow: string;
  stepId: string;
  code: TrajectoryDiagnosticCode;
  detailFingerprint: string;
}): string {
  return [
    "trajectory-diagnostic",
    args.workflow,
    args.stepId,
    args.code,
    args.detailFingerprint,
  ].join(":");
}

function scopeKey(workflow: string, stepId: string): string {
  return `${workflow}\0${stepId}`;
}

function observationKey(observation: DiagnosticObservation): string {
  return [
    observation.workflow,
    observation.stepId,
    observation.code,
    observation.detailFingerprint,
  ].join("\0");
}

function collectDiagnosticObservations(
  runsDir: string,
  runs: RunWithTime[],
): {
  observations: DiagnosticObservation[];
  latestScopeObservationMs: Map<string, number>;
} {
  const observations: DiagnosticObservation[] = [];
  const latestScopeObservationMs = new Map<string, number>();
  for (const entry of runs) {
    if (entry.run.status !== "success" && entry.run.status !== "completed-with-warnings") {
      continue;
    }
    for (const artifactPath of listStepTrajectoryArtifacts(runsDir, entry.run.id)) {
      const stepId = stepIdFromArtifactPath(artifactPath);
      const scope = scopeKey(entry.run.workflow, stepId);
      latestScopeObservationMs.set(
        scope,
        Math.max(latestScopeObservationMs.get(scope) ?? 0, entry.timeMs),
      );
      const artifact = readTrajectoryDiagnosticsArtifact(artifactPath);
      // Unsupported trajectory signals document harness capability boundaries,
      // not process-quality patterns the workflow can repair.
      if (!isEscalatableDiagnosticArtifact(artifact)) continue;
      for (const diagnostic of artifact.diagnostics) {
        if (!isEscalatableDiagnostic(diagnostic)) continue;
        const detailFingerprint = diagnosticDetailFingerprint(diagnostic);
        const fingerprint = patternFingerprint({
          workflow: entry.run.workflow,
          stepId,
          code: diagnostic.code,
          detailFingerprint,
        });
        observations.push({
          workflow: entry.run.workflow,
          stepId,
          code: diagnostic.code,
          detailFingerprint,
          fingerprint,
          runId: entry.run.id,
          timeMs: entry.timeMs,
          timeIso: entry.timeIso,
          artifactPath: repoRelativeTrajectoryArtifactPath(runsDir, artifactPath),
          summary: truncateSingleLine(diagnostic.summary),
          details: boundedDiagnosticDetails(diagnostic),
        });
      }
    }
  }
  return { observations, latestScopeObservationMs };
}

function buildPattern(
  observations: DiagnosticObservation[],
): TrajectoryDiagnosticPattern {
  const chronological = [...observations].sort(
    (a, b) => a.timeMs - b.timeMs || a.runId.localeCompare(b.runId),
  );
  const first = chronological[0]!;
  const runIds = [...new Set(chronological.map((entry) => entry.runId))];
  const artifactPaths = [...new Set(chronological.map((entry) => entry.artifactPath))];
  const fingerprint = first.fingerprint;
  const evidenceFingerprint = stableHash(
    [
      fingerprint,
      ...runIds,
      ...artifactPaths,
      first.summary,
      ...first.details,
    ].join("\0"),
  );
  const reason =
    `${first.workflow}/${first.stepId} emitted ${first.code} in ` +
    `${runIds.length} recent successful workflow run artifacts.`;
  return {
    workflow: first.workflow,
    stepId: first.stepId,
    code: first.code,
    detailFingerprint: first.detailFingerprint,
    fingerprint,
    evidenceFingerprint,
    runIds,
    runCount: runIds.length,
    artifactPaths,
    windowStart: chronological[0]?.timeIso ?? "",
    windowEnd: chronological[chronological.length - 1]?.timeIso ?? "",
    summary: first.summary,
    details: first.details,
    reason,
  };
}

function groupActivePatterns(
  observations: DiagnosticObservation[],
  latestScopeObservationMs: Map<string, number>,
  thresholdRuns: number,
): TrajectoryDiagnosticPattern[] {
  const grouped = new Map<string, DiagnosticObservation[]>();
  for (const observation of observations) {
    const key = observationKey(observation);
    const list = grouped.get(key) ?? [];
    list.push(observation);
    grouped.set(key, list);
  }

  const patterns: TrajectoryDiagnosticPattern[] = [];
  for (const group of grouped.values()) {
    const first = group[0]!;
    const uniqueRunIds = new Set(group.map((entry) => entry.runId));
    if (uniqueRunIds.size < thresholdRuns) continue;

    const latestPatternMs = Math.max(...group.map((entry) => entry.timeMs));
    const latestScopeMs =
      latestScopeObservationMs.get(scopeKey(first.workflow, first.stepId)) ?? 0;
    if (latestPatternMs < latestScopeMs) continue;

    patterns.push(buildPattern(group));
  }

  return patterns.sort(
    (a, b) =>
      b.runCount - a.runCount ||
      a.workflow.localeCompare(b.workflow) ||
      a.stepId.localeCompare(b.stepId) ||
      a.code.localeCompare(b.code) ||
      a.detailFingerprint.localeCompare(b.detailFingerprint),
  );
}

export function detectRecurringTrajectoryDiagnosticPatterns(
  runsDir: string,
  config?: TrajectoryDiagnosticPatternConfig,
): TrajectoryDiagnosticPattern[] {
  const normalized = normalizeConfig(config);
  const cutoffMs = normalized.nowMs - normalized.windowMs;
  const runs = sortRunsNewestFirst(loadRunsInWindow(runsDir, cutoffMs)).filter(
    (entry) => entry.timeMs >= cutoffMs && entry.timeMs <= normalized.nowMs,
  );
  const { observations, latestScopeObservationMs } =
    collectDiagnosticObservations(runsDir, runs);
  return groupActivePatterns(
    observations,
    latestScopeObservationMs,
    normalized.thresholdRuns,
  );
}
