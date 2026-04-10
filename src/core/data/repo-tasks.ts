import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getRepoHeadSha } from "#root/repo-worktree.js";

export const REPO_DATA_DIR = "data";
export const REPO_TASKS_DIR = join(REPO_DATA_DIR, "tasks");
export const REPO_INBOX_DIR = join(REPO_DATA_DIR, "inbox");

export const REPO_TASK_STATES = [
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
  inboxCount: number;
  openCount: number;
  pullableCount: number;
  actionableCount: number;
  headSha: string;
};

export function isRepoTaskQueueSnapshot(
  value: unknown,
): value is RepoTaskQueueSnapshot {
  if (!value || typeof value !== "object" || !("counts" in value)) return false;
  const counts = value.counts as Record<string, unknown>;
  if (!counts || typeof counts !== "object") return false;

  return (
    REPO_TASK_STATES.every((state) => typeof counts[state] === "number") &&
    "inboxCount" in value &&
    typeof value.inboxCount === "number" &&
    "pullableCount" in value &&
    typeof value.pullableCount === "number" &&
    "actionableCount" in value &&
    typeof value.actionableCount === "number"
  );
}

export function getRepoTasksDir(projectDir: string): string {
  return join(projectDir, REPO_TASKS_DIR);
}

export function getRepoInboxDir(projectDir: string): string {
  return join(projectDir, REPO_INBOX_DIR);
}

export function getRepoTaskStateDir(projectDir: string, state: RepoTaskState): string {
  return join(getRepoTasksDir(projectDir), state);
}

export function countRepoTaskState(projectDir: string, state: RepoTaskState): number {
  const dir = getRepoTaskStateDir(projectDir, state);
  if (!existsSync(dir)) return 0;

  return readdirSync(dir).filter(
    (name) => name.endsWith(".md") && name !== "AGENTS.md",
  ).length;
}

export function countRepoInboxEntries(projectDir: string): number {
  const dir = getRepoInboxDir(projectDir);
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter(
    (name) => name.endsWith(".md") && name !== "AGENTS.md",
  ).length;
}

export function getRepoTaskQueueSnapshot(
  projectDir: string,
): RepoTaskQueueSnapshot {
  const counts = Object.fromEntries(
    REPO_TASK_STATES.map((state) => [state, countRepoTaskState(projectDir, state)]),
  ) as Record<RepoTaskState, number>;
  const inboxCount = countRepoInboxEntries(projectDir);

  return {
    counts,
    inboxCount,
    openCount:
      inboxCount +
      counts.backlog +
      counts.ready +
      counts.doing +
      counts.blocked,
    pullableCount: counts.backlog + counts.ready + counts.doing,
    actionableCount: counts.ready + counts.doing,
    headSha: getRepoHeadSha(projectDir),
  };
}

export function isThinPullQueue(snapshot: RepoTaskQueueSnapshot): boolean {
  return (
    snapshot.inboxCount === 0 &&
    snapshot.actionableCount === 0 &&
    snapshot.pullableCount === 1
  );
}
