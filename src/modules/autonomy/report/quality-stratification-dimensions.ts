import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import { normalizePriority } from "./aggregate-queue.js";
import type { QualityRunIndexes } from "./quality-stratification-run-indexes.js";
import type { QualityStratificationDimension } from "./quality-stratification-types.js";

export function taskDimensions(
  task: RepoTaskFullRecord,
): Partial<Record<QualityStratificationDimension, string[]>> {
  return {
    taskPriority: [normalizePriority(task.priority)],
    taskClass: [task.taskClass],
    taskArea: [task.area || "(unset)"],
  };
}

export function runDimensions(
  run: WorkflowRunMetadata,
  indexes: QualityRunIndexes,
  changedFiles?: readonly string[],
): Partial<Record<QualityStratificationDimension, string[]>> {
  const summaryFiles = indexes.summaryByRunId.get(run.id)?.filesChanged ?? [];
  return {
    workflow: [run.workflow],
    harness: harnessesForRun(run),
    changedArea: changedAreasFromFiles(changedFiles ?? summaryFiles),
  };
}

export function sourceRunDimensions(
  runIds: readonly string[],
  indexes: QualityRunIndexes,
): Partial<Record<QualityStratificationDimension, string[]>> {
  const dimensions: Partial<Record<QualityStratificationDimension, string[]>> =
    {};
  for (const runId of runIds) {
    const run = indexes.runById.get(runId);
    if (!run) continue;
    mergeInto(dimensions, runDimensions(run, indexes));
  }
  return dimensions;
}

export function changedAreasFromFiles(files: readonly string[]): string[] {
  return sortedUnique(files.map(changedAreaForFile).filter(Boolean));
}

export function mergeDimensions(
  ...sources: Partial<Record<QualityStratificationDimension, string[]>>[]
): Partial<Record<QualityStratificationDimension, string[]>> {
  const merged: Partial<Record<QualityStratificationDimension, string[]>> = {};
  for (const source of sources) mergeInto(merged, source);
  return merged;
}

export function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function harnessesForRun(run: WorkflowRunMetadata): string[] {
  return sortedUnique(
    run.steps
      .filter((step) => step.type === "agent")
      .map((step) => step.harness?.trim() ?? "")
      .filter((harness) => harness.length > 0),
  );
}

function changedAreaForFile(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "src" && parts[1] === "modules" && parts[2]) {
    return `module:${parts[2]}`;
  }
  if (parts[0] === "src" && parts[1] === "core") return "src/core";
  if (parts[0] === "clients" && parts[1]) return `client:${parts[1]}`;
  return parts[0] ?? "(root)";
}

function mergeInto(
  target: Partial<Record<QualityStratificationDimension, string[]>>,
  source: Partial<Record<QualityStratificationDimension, string[]>>,
): void {
  for (const dimension of Object.keys(source)) {
    const values = source[dimension as QualityStratificationDimension];
    if (!values || values.length === 0) continue;

    const key = dimension as QualityStratificationDimension;
    target[key] = sortedUnique([...(target[key] ?? []), ...values]);
  }
}
