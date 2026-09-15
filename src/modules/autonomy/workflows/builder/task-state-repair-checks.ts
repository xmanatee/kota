import { readGitTextTree } from "#core/util/repository-tree.js";
import { listFullRepoTasks, listRepoTasksFromTree, type RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";

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

  const { tree } = readGitTextTree(workspaceRoot, "HEAD", ["data/tasks"]);
  const previous = new Map(listRepoTasksFromTree(tree).map((task) => [task.id, task.state]));
  const current = new Map(tasks.map((task) => [task.id, task.state]));
  if (previous.get(taskId) !== "open") {
    throw new Error(
      `Builder targeted ${taskId} but its workspace diff does not resolve an open target task.`,
    );
  }
  // Compare states, not touched paths: evidence notes are not transitions, and
  // deleting or reopening another task must not bypass the one-task contract.
  const otherChangedTaskIds = [...new Set([...previous.keys(), ...current.keys()])]
    .filter((id) => id !== taskId && previous.get(id) !== current.get(id) &&
      !(previous.get(id) === undefined && current.get(id) === "open"));
  if (otherChangedTaskIds.length > 0) {
    throw new Error(
      `Builder targeted ${taskId} but its workspace diff also changes task state for ${otherChangedTaskIds.join(", ")}. ` +
        "Resolve only the targeted task in this run.",
    );
  }

  return `OK: workspace resolves targeted task ${taskId}`;
}
