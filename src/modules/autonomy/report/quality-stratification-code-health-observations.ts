import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  isBuilderTerminalRun,
  readCodeHealthRunRecord,
} from "./code-health-drift-reader.js";
import {
  changedAreasFromFiles,
  mergeDimensions,
  runDimensions,
  taskDimensions,
} from "./quality-stratification-dimensions.js";
import type { QualityRunIndexes } from "./quality-stratification-run-indexes.js";
import type {
  QualityBucket,
  QualityObservation,
} from "./quality-stratification-types.js";

type BuildCodeHealthObservationsInput = {
  tasks: readonly RepoTaskFullRecord[];
  runs: readonly WorkflowRunMetadata[];
  runsDir: string;
  windowStartMs: number;
  windowEndMs: number;
};

export function buildCodeHealthQualityObservations(
  input: BuildCodeHealthObservationsInput,
  indexes: QualityRunIndexes,
): QualityObservation[] {
  const openTasks = input.tasks.filter(
    (task) => task.state !== "done" && task.state !== "dropped",
  );
  const observations: QualityObservation[] = [];
  for (const run of input.runs) {
    if (!isBuilderTerminalRun(run)) continue;

    const startedMs = Date.parse(run.startedAt);
    if (!Number.isFinite(startedMs)) continue;

    const bucket = bucketForStartedAt(startedMs, input);
    if (!bucket) continue;

    const result = readCodeHealthRunRecord(input.runsDir, run, openTasks);
    if (result.kind === "unsupported") continue;

    const record = result.kind === "record" ? result.record : null;
    const summary = indexes.summaryByRunId.get(run.id);
    const taskId = record?.taskId ?? summary?.taskId ?? null;
    const task = taskId ? indexes.taskById.get(taskId) : undefined;
    const files = record?.changedSourceFiles ?? summary?.filesChanged ?? [];
    observations.push({
      signal: "code-health-drift",
      bucket,
      denominator: true,
      numerator: record?.outcome === "warning",
      dimensions: mergeDimensions(
        { workflow: [run.workflow] },
        runDimensions(run, indexes, files),
        task ? taskDimensions(task) : {},
        record
          ? {
              reasonFamily: [record.warningFamily],
              changedArea: changedAreasFromFiles([
                ...record.changedSourceFiles,
                ...record.files,
              ]),
            }
          : {},
      ),
      reference: {
        runId: run.id,
        taskId: taskId ?? undefined,
        artifact: record ? "source-file-size-review.json" : "run-summary.json",
      },
    });
  }
  return observations;
}

function bucketForStartedAt(
  startedMs: number,
  input: BuildCodeHealthObservationsInput,
): QualityBucket | null {
  const windowMs = input.windowEndMs - input.windowStartMs;
  if (startedMs >= input.windowStartMs && startedMs <= input.windowEndMs) {
    return "current";
  }
  if (
    startedMs >= input.windowStartMs - windowMs &&
    startedMs < input.windowStartMs
  ) {
    return "prior";
  }
  return null;
}
