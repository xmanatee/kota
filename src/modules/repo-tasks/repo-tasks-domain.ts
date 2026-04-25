import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFlatFrontMatter, serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import { getRepoHeadSha } from "#core/util/repo-worktree.js";

export const REPO_DATA_DIR = "data";
export const REPO_TASKS_DIR = join(REPO_DATA_DIR, "tasks");
export const REPO_INBOX_DIR = join(REPO_DATA_DIR, "inbox");

export const TASK_SOURCE_INTENT_PLACEHOLDER =
  "Preserve the owner request, inbox capture, research source, or runtime evidence that caused this task. Keep urgency and product intent intact.";

export const TASK_INITIATIVE_PLACEHOLDER =
  "Name the broader product, architecture, or autonomy outcome this task advances. For p3 maintenance, write `N/A - scoped maintenance`.";

export const TASK_ACCEPTANCE_EVIDENCE_PLACEHOLDER =
  "- Describe the command, artifact, transcript, screenshot, fixture, or demo that will prove the task is actually done.";

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
  const waitingCount = snapshot.counts.ready + snapshot.counts.backlog;
  return (
    snapshot.inboxCount === 0 &&
    waitingCount <= 2 &&
    (waitingCount > 0 || snapshot.counts.doing > 0)
  );
}

export type RepoTaskFrontmatter = {
  id: string;
  updatedAt: string;
};

export type RepoTaskRecord = {
  frontmatter: RepoTaskFrontmatter;
  body: string;
};

function parseFrontmatterBlock(content: string): Record<string, string> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return fields;
}

function extractBodyAfterFrontmatter(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/);
  return match ? match[1] : "";
}

/**
 * List task records in a given state with their frontmatter id/updated_at and
 * body. Tasks missing either id or updated_at are skipped so callers can treat
 * the result as strict.
 */
export function listRepoTasksInState(
  projectDir: string,
  state: RepoTaskState,
): RepoTaskRecord[] {
  const dir = getRepoTaskStateDir(projectDir, state);
  if (!existsSync(dir)) return [];

  const records: RepoTaskRecord[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md") || name === "AGENTS.md") continue;
    const content = readFileSync(join(dir, name), "utf-8");
    const fm = parseFrontmatterBlock(content);
    if (!fm || !fm.id || !fm.updated_at) continue;
    records.push({
      frontmatter: { id: fm.id, updatedAt: fm.updated_at },
      body: extractBodyAfterFrontmatter(content),
    });
  }
  return records;
}

export type MoveTaskResult = {
  id: string;
  fromState: RepoTaskState;
  toState: RepoTaskState;
  /** Repo-relative destination path. */
  path: string;
  /** Repo-relative previous path. */
  previousPath: string;
};

/**
 * Move a normalized task file between state directories, atomically updating
 * the `status` and `updated_at` frontmatter fields and staging both the
 * rename and the rewritten file with `git`.
 *
 * This is the single mechanism for state transitions; the `kota task move`
 * CLI and autonomy workflows both call it. Throws when the task is not found,
 * is already in the target state, or when the git operations fail.
 */
export function moveTaskById(
  projectDir: string,
  id: string,
  toState: RepoTaskState,
): MoveTaskResult {
  const tasksDir = getRepoTasksDir(projectDir);
  let fromState: RepoTaskState | null = null;
  let fromPath: string | null = null;
  for (const state of REPO_TASK_STATES) {
    const candidate = join(tasksDir, state, `${id}.md`);
    if (existsSync(candidate)) {
      fromState = state;
      fromPath = candidate;
      break;
    }
  }
  if (!fromState || !fromPath) {
    throw new Error(`Task "${id}" not found in any state directory`);
  }
  if (fromState === toState) {
    throw new Error(`Task "${id}" is already in "${toState}"`);
  }
  const dstPath = join(tasksDir, toState, `${id}.md`);
  const content = readFileSync(fromPath, "utf-8");
  const { attrs, body } = parseFlatFrontMatter(content);
  attrs.status = toState;
  attrs.updated_at = new Date().toISOString();
  const updated = serializeFlatFrontMatter(attrs, body);

  execFileSync("git", ["mv", fromPath, dstPath], { cwd: projectDir });
  writeFileSync(dstPath, updated, "utf-8");
  execFileSync("git", ["add", dstPath], { cwd: projectDir });

  return {
    id,
    fromState,
    toState,
    path: dstPath.slice(projectDir.length + 1),
    previousPath: fromPath.slice(projectDir.length + 1),
  };
}

export type DaemonTaskDetail = {
  id: string;
  title: string;
  priority: string;
  area: string;
  summary: string;
  body: string;
};

export type DaemonTaskStatusResponse = {
  counts: { inbox: number; ready: number; backlog: number; doing: number; blocked: number };
  tasks: {
    doing: DaemonTaskDetail[];
    ready: DaemonTaskDetail[];
    backlog: DaemonTaskDetail[];
    blocked: DaemonTaskDetail[];
  };
};
