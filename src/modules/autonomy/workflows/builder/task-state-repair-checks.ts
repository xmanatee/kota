import { listWorkflowMutatedPaths } from "#core/workflow/steps/agent-write-scope.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";

function terminalTaskId(path: string): string | null {
  return path.match(/^data\/tasks\/(?:done|blocked|dropped)\/(task-[^/]+)\.md$/)?.[1] ?? null;
}

export function checkTargetTaskResolved(
  workspaceRoot: string,
  taskId: string,
): string {
  const task = listFullRepoTasks(workspaceRoot).find((candidate) => candidate.id === taskId);
  if (!task || !["done", "blocked", "dropped"].includes(task.state)) {
    throw new Error(
      `Builder must move targeted task ${taskId} to done, blocked, or dropped before stopping.`,
    );
  }

  const completedTaskIds = listWorkflowMutatedPaths(workspaceRoot)
    .map(terminalTaskId)
    .filter((candidate): candidate is string => candidate !== null);
  if (!completedTaskIds.includes(taskId)) {
    throw new Error(
      `Builder targeted ${taskId} but its workspace diff does not contain a terminal task transition.`,
    );
  }
  const otherCompletedTaskIds = completedTaskIds.filter((candidate) => candidate !== taskId);
  if (otherCompletedTaskIds.length > 0) {
    throw new Error(
      `Builder targeted ${taskId} but its workspace diff also completes ${otherCompletedTaskIds.join(", ")}. ` +
        "Finish only the targeted task in this run.",
    );
  }

  return `OK: workspace resolves targeted task ${taskId}`;
}
