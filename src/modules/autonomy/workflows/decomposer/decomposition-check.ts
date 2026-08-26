import { join } from "node:path";
import { listWorkflowMutatedPaths } from "#core/workflow/steps/agent-write-scope.js";
import {
  extractTaskSections,
  listFullRepoTasks,
  REPO_TASKS_DIR,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { extractRepoTaskIds } from "#modules/repo-tasks/task-id.js";

const DECOMPOSED_SECTION = "Decomposed";

export function checkDecompositionApplied(workspaceRoot: string, taskId: string): string {
  const tasks = listFullRepoTasks(workspaceRoot);
  const original = tasks.find((task) => task.id === taskId);
  if (!original || original.state !== "dropped") {
    throw new Error(`Decomposer must move ${taskId} to dropped`);
  }

  const section = extractTaskSections(original.body, [DECOMPOSED_SECTION])[
    DECOMPOSED_SECTION
  ];
  if (!section) {
    throw new Error(`Dropped task ${taskId} must include a ## Decomposed section`);
  }

  const subtaskIds = [
    ...new Set(
      extractRepoTaskIds(section).filter(
        (candidate) => candidate !== taskId,
      ),
    ),
  ];
  if (subtaskIds.length === 0) {
    throw new Error(`## Decomposed for ${taskId} must name at least one subtask`);
  }

  const readyTaskIds = new Set(
    tasks.filter((task) => task.state === "ready").map((task) => task.id),
  );
  const missingReadyTasks = subtaskIds.filter((id) => !readyTaskIds.has(id));
  if (missingReadyTasks.length > 0) {
    throw new Error(
      `Decomposed subtasks must exist in ready: ${missingReadyTasks.join(", ")}`,
    );
  }

  const mutatedPaths = new Set(listWorkflowMutatedPaths(workspaceRoot));
  const requiredPaths = [
    join(REPO_TASKS_DIR, "dropped", `${taskId}.md`),
    ...subtaskIds.map((id) => join(REPO_TASKS_DIR, "ready", `${id}.md`)),
  ];
  const unchangedPaths = requiredPaths.filter((path) => !mutatedPaths.has(path));
  if (unchangedPaths.length > 0) {
    throw new Error(
      `Decomposition must create or update its task files: ${unchangedPaths.join(", ")}`,
    );
  }

  return `OK: dropped ${taskId} and prepared ${subtaskIds.length} ready subtask(s)`;
}
