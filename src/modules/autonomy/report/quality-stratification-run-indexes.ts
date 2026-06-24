import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { WorkflowRunSummary } from "#modules/autonomy/run-summary.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";

export type BuildQualityRunIndexesInput = {
  tasks: readonly RepoTaskFullRecord[];
  runs: readonly WorkflowRunMetadata[];
  runsDir: string;
};

export type QualityRunIndexes = {
  taskById: Map<string, RepoTaskFullRecord>;
  runById: Map<string, WorkflowRunMetadata>;
  summaryByRunId: Map<string, WorkflowRunSummary | null>;
  runIdsByTaskId: Map<string, string[]>;
};

export function buildQualityRunIndexes(
  input: BuildQualityRunIndexesInput,
): QualityRunIndexes {
  const taskById = new Map(input.tasks.map((task) => [task.id, task]));
  const runById = new Map(input.runs.map((run) => [run.id, run]));
  const summaryByRunId = new Map<string, WorkflowRunSummary | null>();
  const runIdsByTaskId = new Map<string, string[]>();

  for (const run of input.runs) {
    const summary = readOptionalJsonFile<WorkflowRunSummary>(
      join(input.runsDir, run.id, "run-summary.json"),
    );
    summaryByRunId.set(run.id, summary);
    if (!summary?.taskId) continue;

    const existing = runIdsByTaskId.get(summary.taskId) ?? [];
    existing.push(run.id);
    runIdsByTaskId.set(summary.taskId, existing);
  }

  return { taskById, runById, summaryByRunId, runIdsByTaskId };
}
