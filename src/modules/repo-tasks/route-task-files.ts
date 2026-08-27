import { readdirSync, readFileSync } from "node:fs";
import type { DaemonTaskDetail, RepoTaskState } from "./repo-tasks-domain.js";
import {
  listFullRepoTasks,
  listRepoTaskDependencyWaits,
} from "./repo-tasks-domain.js";

export const COUNTED_STATES = ["inbox", "open", "blocked"] as const;
export const DETAIL_STATES = ["open", "blocked"] as const;

function isMissingPathError(error: Error): boolean {
  return "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

export function countMarkdownFiles(dir: string): number {
  try {
    return readdirSync(dir).filter((file) => file.endsWith(".md") && file !== "AGENTS.md").length;
  } catch (error) {
    if (error instanceof Error && isMissingPathError(error)) return 0;
    throw error;
  }
}

export function tryReadUtf8(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch (error) {
    if (error instanceof Error && isMissingPathError(error)) return null;
    throw error;
  }
}

export function readStateTasks(
  repoRoot: string,
  _tasksDir: string,
  state: "open" | "blocked",
  inProgressTaskIds: ReadonlySet<string> = new Set(),
): DaemonTaskDetail[] {
  const waitingById = new Map(
    listRepoTaskDependencyWaits(repoRoot, [state]).map((wait) => [wait.id, wait.waitingOn]),
  );
  return listFullRepoTasks(repoRoot, [state]).map((task) => ({
    id: task.id,
    title: task.title,
    priority: task.priority!,
    body: task.body.trim(),
    waitingOnTasks: waitingById.get(task.id) ?? [],
    inProgress: inProgressTaskIds.has(task.id),
  }));
}

export function findTaskInOpenStates(
  repoRoot: string,
  id: string,
): { state: RepoTaskState; filename: string; content: string } | null {
  const task = listFullRepoTasks(repoRoot, ["open", "blocked"]).find((entry) => entry.id === id);
  if (!task) return null;
  return { state: task.state, filename: `${task.id}.md`, content: task.body };
}
