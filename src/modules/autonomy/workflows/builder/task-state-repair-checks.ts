import { listWorkflowMutatedPaths } from "#core/workflow/steps/agent-write-scope.js";
import { listFullRepoTasks, type RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";

function taskIdFromPath(path: string): string | null {
  return path.match(/^data\/tasks\/(?:archive\/)?(task-[^/]+)\.md$/)?.[1] ?? null;
}

export function requireResolvedTargetTask(
  tasks: readonly RepoTaskFullRecord[],
  taskId: string,
): void {
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task || !["done", "blocked", "dropped"].includes(task.state)) {
    throw new Error(
      `Builder must move targeted task ${taskId} to done, blocked, or dropped before stopping.`,
    );
  }
}

export function checkTargetTaskResolved(
  workspaceRoot: string,
  taskId: string,
): string {
  const tasks = listFullRepoTasks(workspaceRoot);
  requireResolvedTargetTask(tasks, taskId);

  const terminalTaskIds = new Set(
    tasks
      .filter((candidate) => ["done", "blocked", "dropped"].includes(candidate.state))
      .map((candidate) => candidate.id),
  );
  const completedTaskIds = [...new Set(
    listWorkflowMutatedPaths(workspaceRoot)
      .map(taskIdFromPath)
      .filter(
        (candidate): candidate is string =>
          candidate !== null && terminalTaskIds.has(candidate),
      ),
  )];
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
