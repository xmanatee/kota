import { basename } from "node:path";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import { readAutonomyRunDeliveryEvidence } from "#modules/autonomy/run-delivery-evidence.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import { normalizePriority } from "./aggregate-queue.js";
import type { ExplorerBalance, ExplorerTaskAddition } from "./aggregate-types.js";
import type { AreaClassification } from "./task-classification.js";
import { classifyTaskShape } from "./task-classification.js";

export function buildExplorerBalance(
  runs: WorkflowRunMetadata[],
  taskById: Map<string, RepoTaskFullRecord>,
  runsDir: string,
): ExplorerBalance {
  const additions: ExplorerTaskAddition[] = [];
  let totalRuns = 0;
  let unresolvedTaskAdditions = 0;
  for (const run of runs) {
    if (run.workflow !== "explorer") continue;
    if (run.status !== "success") continue;
    totalRuns += 1;
    const addedTaskFiles = readAutonomyRunDeliveryEvidence(
      runsDir,
      run,
    )?.changedPaths.filter((path) => path.startsWith("data/tasks/")) ?? [];
    if (addedTaskFiles.length === 0) continue;
    for (const filePath of addedTaskFiles) {
      const taskId = extractTaskIdFromFilePath(filePath);
      if (!taskId) {
        unresolvedTaskAdditions += 1;
        continue;
      }
      const task = taskById.get(taskId);
      if (!task) {
        unresolvedTaskAdditions += 1;
        continue;
      }
      additions.push({
        runId: run.id,
        taskId,
        title: task.title,
        area: task.area || "(unset)",
        priority: normalizePriority(task.priority),
        classification: classifyTaskShape({
          area: task.area,
          title: task.title,
          summary: task.summary,
        }),
      });
    }
  }
  const byClassification = countClassifications(
    additions.map((a) => a.classification),
  );
  return {
    totalRuns,
    totalTaskAdditions: additions.length,
    unresolvedTaskAdditions,
    byClassification,
    taskAdditions: additions,
  };
}

function extractTaskIdFromFilePath(filePath: string): string | null {
  const name = basename(filePath);
  if (!name.endsWith(".md")) return null;
  const id = name.slice(0, -3);
  if (!id.startsWith("task-")) return null;
  return id;
}

function countClassifications(
  values: AreaClassification[],
): { classification: AreaClassification; tasks: number }[] {
  const counts = new Map<AreaClassification, number>([
    ["strategic", 0],
    ["fan-out", 0],
    ["other", 0],
  ]);
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].map(([classification, tasks]) => ({
    classification,
    tasks,
  }));
}
