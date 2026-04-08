import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getRepoHeadSha } from "./repo-worktree.js";

export const REPO_TASK_STATES = [
  "inbox",
  "backlog",
  "ready",
  "doing",
  "blocked",
  "done",
  "dropped",
] as const;

export type RepoTaskState = (typeof REPO_TASK_STATES)[number];

export type RepoTaskQueueSnapshot = {
  counts: Record<RepoTaskState, number>;
  openCount: number;
  actionableCount: number;
  headSha: string;
};

export function isRepoTaskQueueSnapshot(
  value: unknown,
): value is RepoTaskQueueSnapshot {
  if (!value || typeof value !== "object" || !("counts" in value)) return false;
  const counts = value.counts as Record<string, unknown>;
  if (!counts || typeof counts !== "object") return false;

  return REPO_TASK_STATES.every((state) => typeof counts[state] === "number");
}

export function countRepoTasks(
  projectDir: string,
  state: RepoTaskState,
): number {
  const dir = join(projectDir, "tasks", state);
  if (!existsSync(dir)) return 0;

  return readdirSync(dir).filter(
    (name) => name.endsWith(".md") && name !== "AGENTS.md",
  ).length;
}

export function getRepoTaskQueueSnapshot(
  projectDir: string,
): RepoTaskQueueSnapshot {
  const counts = Object.fromEntries(
    REPO_TASK_STATES.map((state) => [state, countRepoTasks(projectDir, state)]),
  ) as Record<RepoTaskState, number>;

  return {
    counts,
    openCount:
      counts.inbox +
      counts.backlog +
      counts.ready +
      counts.doing +
      counts.blocked,
    actionableCount: counts.ready + counts.doing,
    headSha: getRepoHeadSha(projectDir),
  };
}
