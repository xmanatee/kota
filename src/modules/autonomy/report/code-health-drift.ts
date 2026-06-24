import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  addCoverage,
  buildRepeatedSurfaces,
  surfaceAreaForFile,
} from "./code-health-drift-coverage.js";
import {
  isBuilderTerminalRun,
  readCodeHealthRunRecord,
} from "./code-health-drift-reader.js";
import type {
  BuildCodeHealthDriftReportInput,
  CodeHealthCleanupCoverage,
  CodeHealthDriftRecord,
  CodeHealthDriftReport,
  CodeHealthTrendBucket,
} from "./code-health-drift-types.js";

export type {
  BuildCodeHealthDriftReportInput,
  CodeHealthCleanupCoverage,
  CodeHealthCountRow,
  CodeHealthDriftOutcome,
  CodeHealthDriftRecord,
  CodeHealthDriftReport,
  CodeHealthRepeatedSurface,
  CodeHealthTrendBucket,
  CodeHealthWarningFamily,
} from "./code-health-drift-types.js";

const OPEN_TASK_STATES = new Set(["backlog", "ready", "doing", "blocked"]);

export function buildCodeHealthDriftReport(
  input: BuildCodeHealthDriftReportInput,
): CodeHealthDriftReport {
  const windowMs = input.windowEndMs - input.windowStartMs;
  const priorStartMs = input.windowStartMs - windowMs;
  const buckets = new Map<CodeHealthTrendBucket["bucket"], CodeHealthTrendBucket>([
    ["current", emptyBucket("current")],
    ["prior", emptyBucket("prior")],
  ]);
  const openTasks = input.tasks.filter(isOpenTask);
  const exceptionCoverageByFile = new Map<string, CodeHealthCleanupCoverage[]>();
  const currentRecords: CodeHealthDriftRecord[] = [];
  const warningRecords: Array<{ record: CodeHealthDriftRecord; bucket: "current" | "prior" }> = [];

  for (const run of input.runs) {
    if (!isBuilderTerminalRun(run)) continue;
    const startedMs = Date.parse(run.startedAt);
    if (!Number.isFinite(startedMs) || startedMs < priorStartMs || startedMs > input.windowEndMs) {
      continue;
    }
    const bucketName = startedMs >= input.windowStartMs ? "current" : "prior";
    const bucket = buckets.get(bucketName)!;
    bucket.totalBuilderRuns += 1;

    const result = readCodeHealthRunRecord(input.runsDir, run, openTasks);
    if (result.kind === "unsupported") {
      bucket.unsupportedArtifacts += 1;
      continue;
    }
    if (result.kind === "clean") continue;
    recordBucketOutcome(result.record, bucket, bucketName, warningRecords);
    collectExceptionCoverage(result.record, exceptionCoverageByFile);
    if (bucketName === "current") currentRecords.push(result.record);
  }

  return {
    totalBuilderRuns: buckets.get("current")!.totalBuilderRuns,
    runsWithWarnings: buckets.get("current")!.runsWithWarnings,
    unsupportedArtifacts: buckets.get("current")!.unsupportedArtifacts,
    byWarningFamily: countCurrentWarnings(
      currentRecords,
      (record) => record.warningFamily,
      (record) => record.warningCount,
    ),
    bySurfaceArea: countCurrentWarnings(currentRecords, (record) =>
      record.files.map(surfaceAreaForFile)
    ),
    repeatedSurfaces: buildRepeatedSurfaces(
      warningRecords,
      openTasks,
      exceptionCoverageByFile,
    ),
    trendBuckets: [buckets.get("current")!, buckets.get("prior")!],
    records: currentRecords
      .sort((left, right) => right.runId.localeCompare(left.runId))
      .slice(0, 12),
  };
}

function recordBucketOutcome(
  record: CodeHealthDriftRecord,
  bucket: CodeHealthTrendBucket,
  bucketName: "current" | "prior",
  warningRecords: Array<{ record: CodeHealthDriftRecord; bucket: "current" | "prior" }>,
): void {
  if (record.outcome === "cleanup-exception") {
    bucket.cleanupExceptionRuns += 1;
    return;
  }
  bucket.runsWithWarnings += 1;
  bucket.warningRecords += record.warningCount;
  warningRecords.push({ record, bucket: bucketName });
}

function collectExceptionCoverage(
  record: CodeHealthDriftRecord,
  coverageByFile: Map<string, CodeHealthCleanupCoverage[]>,
): void {
  if (record.outcome !== "cleanup-exception") return;
  for (const coverage of record.cleanupCoverage) {
    if (coverage.kind !== "cleanup-exception") continue;
    for (const file of coverage.files) addCoverage(coverageByFile, file, coverage);
  }
}

function countCurrentWarnings(
  records: readonly CodeHealthDriftRecord[],
  keyFn: (record: CodeHealthDriftRecord) => string | readonly string[],
  countFn: (record: CodeHealthDriftRecord) => number = () => 1,
) {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (record.outcome !== "warning") continue;
    const keys = keyFn(record);
    const count = countFn(record);
    for (const key of typeof keys === "string" ? [keys] : keys) {
      counts.set(key, (counts.get(key) ?? 0) + count);
    }
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function emptyBucket(bucket: CodeHealthTrendBucket["bucket"]): CodeHealthTrendBucket {
  return {
    bucket,
    totalBuilderRuns: 0,
    runsWithWarnings: 0,
    warningRecords: 0,
    cleanupExceptionRuns: 0,
    unsupportedArtifacts: 0,
  };
}

function isOpenTask(task: RepoTaskFullRecord): boolean {
  return OPEN_TASK_STATES.has(task.state);
}
