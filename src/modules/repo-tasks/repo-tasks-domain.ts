import { existsSync, readdirSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { parseFlatFrontMatter, serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import { getRepoHeadSha } from "#core/util/repo-worktree.js";
import {
  type FileSnapshot,
  listVerifiedRepoMarkdownFiles,
  moveRepoMarkdownFile,
  readVerifiedRepoMarkdownFile,
  readVerifiedRepoMarkdownFileWithIdentity,
  removeRepoMarkdownFile,
  writeRepoMarkdownFile,
} from "./repo-file-mutations.js";
import {
  findUnfinishedTaskDependencies,
  readTaskDependencyIds,
} from "./task-dependencies.js";
import { isRepoTaskId } from "./task-id.js";

export const REPO_DATA_DIR = "data";
export const REPO_TASKS_DIR = join(REPO_DATA_DIR, "tasks");
export const REPO_TASK_ARCHIVE_DIR = join(REPO_TASKS_DIR, "archive");
export const REPO_INBOX_DIR = join(REPO_DATA_DIR, "inbox");

export {
  buildIndexableTaskText,
  extractTaskSections,
  INDEXABLE_TASK_SECTIONS,
} from "./repo-task-sections.js";

export const REPO_TASK_STATES = ["open", "blocked", "done", "dropped"] as const;
export const ACTIVE_REPO_TASK_STATES = ["open", "blocked"] as const;
export const ARCHIVED_REPO_TASK_STATES = ["done", "dropped"] as const;

export type RepoTaskState = (typeof REPO_TASK_STATES)[number];
export type ActiveRepoTaskState = (typeof ACTIVE_REPO_TASK_STATES)[number];
export type ArchivedRepoTaskState = (typeof ARCHIVED_REPO_TASK_STATES)[number];
export type RepoTaskPriority = "p0" | "p1" | "p2" | "p3";

export function isActiveRepoTaskState(state: RepoTaskState): state is ActiveRepoTaskState {
  return state === "open" || state === "blocked";
}

export function isArchivedRepoTaskState(state: RepoTaskState): state is ArchivedRepoTaskState {
  return state === "done" || state === "dropped";
}

export type RepoTaskQueueSnapshot = {
  counts: Record<RepoTaskState, number>;
  inboxCount: number;
  activeCount: number;
  actionableCount: number;
  dispatchableCount: number;
  hasDispatchableWork: boolean;
  dependencyBlockedTasks: RepoTaskDependencyWait[];
  headSha: string;
};

export function isRepoTaskQueueSnapshot(value: unknown): value is RepoTaskQueueSnapshot {
  if (!value || typeof value !== "object" || !("counts" in value)) return false;
  const counts = value.counts as Record<string, unknown>;
  if (!counts || typeof counts !== "object") return false;
  return (
    REPO_TASK_STATES.every((state) => typeof counts[state] === "number") &&
    "inboxCount" in value &&
    typeof value.inboxCount === "number" &&
    "activeCount" in value &&
    typeof value.activeCount === "number" &&
    "actionableCount" in value &&
    typeof value.actionableCount === "number" &&
    "dispatchableCount" in value &&
    typeof value.dispatchableCount === "number" &&
    "hasDispatchableWork" in value &&
    typeof value.hasDispatchableWork === "boolean" &&
    "dependencyBlockedTasks" in value &&
    Array.isArray(value.dependencyBlockedTasks)
  );
}

export function getRepoTasksDir(repoRoot: string): string {
  return join(repoRoot, REPO_TASKS_DIR);
}

export function getRepoTaskArchiveDir(repoRoot: string): string {
  return join(repoRoot, REPO_TASK_ARCHIVE_DIR);
}

export function getRepoInboxDir(repoRoot: string): string {
  return join(repoRoot, REPO_INBOX_DIR);
}

export function getRepoTaskContainerDir(repoRoot: string, state: RepoTaskState): string {
  return isArchivedRepoTaskState(state)
    ? getRepoTaskArchiveDir(repoRoot)
    : getRepoTasksDir(repoRoot);
}

export function getRepoTaskPath(repoRoot: string, state: RepoTaskState, id: string): string {
  return join(getRepoTaskContainerDir(repoRoot, state), `${id}.md`);
}

export function writeRepoTaskFile(repoRoot: string, filePath: string, content: string): void {
  writeRepoMarkdownFile({
    repoRoot,
    rootDir: getRepoTasksDir(repoRoot),
    filePath,
    content,
  });
}

export function writeRepoInboxFile(repoRoot: string, filePath: string, content: string): void {
  writeRepoMarkdownFile({
    repoRoot,
    rootDir: getRepoInboxDir(repoRoot),
    filePath,
    content,
  });
}

export function readRepoInboxFile(repoRoot: string, filePath: string): string | null {
  return readVerifiedRepoMarkdownFile({
    repoRoot,
    rootDir: getRepoInboxDir(repoRoot),
    filePath,
  });
}

export function removeRepoInboxFile(repoRoot: string, filePath: string): boolean {
  const inboxDir = getRepoInboxDir(repoRoot);
  if (readVerifiedRepoMarkdownFile({ repoRoot, rootDir: inboxDir, filePath }) === null) {
    return false;
  }
  removeRepoMarkdownFile({ repoRoot, rootDir: inboxDir, filePath });
  return true;
}

export function countRepoInboxEntries(repoRoot: string): number {
  const dir = getRepoInboxDir(repoRoot);
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((name) => name.endsWith(".md") && name !== "AGENTS.md").length;
}

function parseRepoTaskState(raw: unknown, path: string): RepoTaskState {
  if (typeof raw === "string" && REPO_TASK_STATES.includes(raw as RepoTaskState)) {
    return raw as RepoTaskState;
  }
  throw new Error(`Task entry ${path} has invalid status ${String(raw)}`);
}

function parseRepoTaskPriority(raw: unknown, path: string): RepoTaskPriority {
  if (typeof raw === "string" && ["p0", "p1", "p2", "p3"].includes(raw)) {
    return raw as RepoTaskPriority;
  }
  throw new Error(`Active task entry ${path} has invalid priority ${String(raw)}`);
}

export function extractRepoTaskTitle(body: string, path = "task"): string {
  const title = body.match(/^#\s+(.+)\s*$/m)?.[1]?.trim();
  if (!title) throw new Error(`Task entry ${path} must begin its body with a level-one title`);
  return title;
}

export type RepoTaskFullRecord = {
  id: string;
  title: string;
  state: RepoTaskState;
  priority: RepoTaskPriority | null;
  body: string;
  dependsOn: string[];
};

export type RepoTaskFileDescriptor = {
  path: string;
  snapshot: FileSnapshot;
};

export type VerifiedRepoTaskFullRecord = RepoTaskFullRecord & {
  taskFile: RepoTaskFileDescriptor;
};

type TaskContainer = {
  directory: string;
  archived: boolean;
};

function taskContainers(repoRoot: string): TaskContainer[] {
  return [
    { directory: getRepoTasksDir(repoRoot), archived: false },
    { directory: getRepoTaskArchiveDir(repoRoot), archived: true },
  ];
}

function recordFromEntry(args: {
  repoRoot: string;
  container: TaskContainer;
  name: string;
  content: string;
  snapshot: FileSnapshot;
}): VerifiedRepoTaskFullRecord {
  const id = basename(args.name, ".md");
  const path = relative(args.repoRoot, join(args.container.directory, args.name));
  if (!isRepoTaskId(id)) throw new Error(`Task entry ${path} has invalid filename identity`);
  const { attrs, body } = parseFlatFrontMatter(args.content);
  const state = parseRepoTaskState(attrs.status, path);
  if (args.container.archived !== isArchivedRepoTaskState(state)) {
    throw new Error(`Task entry ${path} is stored in the wrong task container for ${state}`);
  }
  const priority = isActiveRepoTaskState(state)
    ? parseRepoTaskPriority(attrs.priority, path)
    : null;
  const dependsOn = isActiveRepoTaskState(state) ? readTaskDependencyIds(attrs) : [];
  return {
    id,
    title: extractRepoTaskTitle(body, path),
    state,
    priority,
    body,
    dependsOn,
    taskFile: { path, snapshot: args.snapshot },
  };
}

export function listVerifiedFullRepoTasks(
  repoRoot: string,
  states: readonly RepoTaskState[] = REPO_TASK_STATES,
): VerifiedRepoTaskFullRecord[] {
  const wanted = new Set(states);
  const result: VerifiedRepoTaskFullRecord[] = [];
  for (const container of taskContainers(repoRoot)) {
    for (const entry of listVerifiedRepoMarkdownFiles({
      repoRoot,
      rootDir: getRepoTasksDir(repoRoot),
      directoryPath: container.directory,
    })) {
      if (entry.name === "AGENTS.md") continue;
      const record = recordFromEntry({ repoRoot, container, ...entry });
      if (wanted.has(record.state)) result.push(record);
    }
  }
  return result;
}

export function listFullRepoTasks(
  repoRoot: string,
  states: readonly RepoTaskState[] = REPO_TASK_STATES,
): RepoTaskFullRecord[] {
  return listVerifiedFullRepoTasks(repoRoot, states);
}

export function countRepoTaskState(repoRoot: string, state: RepoTaskState): number {
  return listFullRepoTasks(repoRoot, [state]).length;
}

export function readVerifiedRepoTaskFile(
  repoRoot: string,
  state: RepoTaskState,
  id: string,
): ({ content: string } & RepoTaskFileDescriptor) | null {
  if (!isRepoTaskId(id)) throw new Error(`Invalid task id: ${id}`);
  const path = getRepoTaskPath(repoRoot, state, id);
  const verified = readVerifiedRepoMarkdownFileWithIdentity({
    repoRoot,
    rootDir: getRepoTasksDir(repoRoot),
    filePath: path,
  });
  if (verified === null) return null;
  const { attrs } = parseFlatFrontMatter(verified.content);
  if (parseRepoTaskState(attrs.status, relative(repoRoot, path)) !== state) return null;
  return {
    path: relative(repoRoot, path),
    content: verified.content,
    snapshot: verified.snapshot,
  };
}

export type RepoTaskDependencyWait = {
  id: string;
  title: string;
  state: ActiveRepoTaskState;
  dependsOn: string[];
  waitingOn: string[];
};

export function listRepoTaskDependencyWaits(
  repoRoot: string,
  states: readonly ActiveRepoTaskState[] = ACTIVE_REPO_TASK_STATES,
): RepoTaskDependencyWait[] {
  const allTasks = listFullRepoTasks(repoRoot);
  const stateByTaskId = new Map(allTasks.map((task) => [task.id, task.state]));
  const wanted = new Set(states);
  return allTasks
    .filter((task): task is RepoTaskFullRecord & { state: ActiveRepoTaskState } =>
      isActiveRepoTaskState(task.state) && wanted.has(task.state),
    )
    .map((task) => ({
      id: task.id,
      title: task.title,
      state: task.state,
      dependsOn: task.dependsOn,
      waitingOn: findUnfinishedTaskDependencies(task.dependsOn, stateByTaskId),
    }))
    .filter((task) => task.waitingOn.length > 0);
}

export function getUnfinishedTaskDependencies(
  repoRoot: string,
  dependencies: readonly string[],
): string[] {
  const stateByTaskId = new Map(
    listFullRepoTasks(repoRoot).map((task) => [task.id, task.state]),
  );
  return findUnfinishedTaskDependencies(dependencies, stateByTaskId);
}

export function getRepoTaskQueueSnapshot(repoRoot: string): RepoTaskQueueSnapshot {
  const counts = Object.fromEntries(
    REPO_TASK_STATES.map((state) => [state, countRepoTaskState(repoRoot, state)]),
  ) as Record<RepoTaskState, number>;
  const inboxCount = countRepoInboxEntries(repoRoot);
  const dependencyBlockedTasks = listRepoTaskDependencyWaits(repoRoot, ["open"]);
  const actionableCount = counts.open - dependencyBlockedTasks.length;
  const dispatchableCount = inboxCount + actionableCount;
  return {
    counts,
    inboxCount,
    activeCount: counts.open + counts.blocked,
    actionableCount,
    dispatchableCount,
    hasDispatchableWork: dispatchableCount > 0,
    dependencyBlockedTasks,
    headSha: getRepoHeadSha(repoRoot),
  };
}

export function isThinDispatchableQueue(snapshot: RepoTaskQueueSnapshot): boolean {
  return snapshot.inboxCount === 0 && snapshot.actionableCount > 0 && snapshot.actionableCount <= 2;
}

export type RepoTaskRecord = {
  id: string;
  state: RepoTaskState;
  body: string;
  observedModifiedAt: string;
};

export function listRepoTasksInState(repoRoot: string, state: RepoTaskState): RepoTaskRecord[] {
  return listVerifiedFullRepoTasks(repoRoot, [state]).map((task) => ({
    id: task.id,
    state: task.state,
    body: task.body,
    observedModifiedAt: new Date(task.taskFile.snapshot.mtimeMs).toISOString(),
  }));
}

export type MoveTaskResult = {
  id: string;
  fromState: RepoTaskState;
  toState: RepoTaskState;
  path: string;
  previousPath: string;
};

function locateTask(repoRoot: string, id: string): { record: VerifiedRepoTaskFullRecord; content: string } {
  const record = listVerifiedFullRepoTasks(repoRoot).find((task) => task.id === id);
  if (!record) throw new Error(`Task "${id}" not found`);
  const content = readVerifiedRepoMarkdownFile({
    repoRoot,
    rootDir: getRepoTasksDir(repoRoot),
    filePath: join(repoRoot, record.taskFile.path),
  });
  if (content === null) throw new Error(`Task "${id}" disappeared while being read`);
  return { record, content };
}

function transitionTask(args: {
  repoRoot: string;
  id: string;
  toState: RepoTaskState;
  reopeningPriority?: RepoTaskPriority;
}): MoveTaskResult {
  if (!isRepoTaskId(args.id)) throw new Error("Invalid task id");
  const { record, content } = locateTask(args.repoRoot, args.id);
  if (record.state === args.toState) {
    throw new Error(`Task "${args.id}" is already in "${args.toState}"`);
  }
  if (isArchivedRepoTaskState(record.state) && isActiveRepoTaskState(args.toState)) {
    if (args.toState !== "open" || !args.reopeningPriority) {
      throw new Error(`Archived task "${args.id}" can only reopen with an explicit priority`);
    }
  }
  const sourcePath = join(args.repoRoot, record.taskFile.path);
  const destinationPath = getRepoTaskPath(args.repoRoot, args.toState, args.id);
  const { attrs: priorAttrs, body } = parseFlatFrontMatter(content);
  const attrs: Record<string, string | string[]> = isArchivedRepoTaskState(args.toState)
    ? { status: args.toState }
    : {
        status: args.toState,
        priority: args.reopeningPriority ?? record.priority ?? "",
        ...(record.dependsOn.length > 0 ? { depends_on: record.dependsOn } : {}),
      };
  if (isActiveRepoTaskState(args.toState) && !args.reopeningPriority) {
    attrs.priority = priorAttrs.priority as string;
  }
  const updated = serializeFlatFrontMatter(attrs, body);
  if (sourcePath === destinationPath) {
    writeRepoTaskFile(args.repoRoot, sourcePath, updated);
  } else {
    moveRepoMarkdownFile({
      repoRoot: args.repoRoot,
      sourceRootDir: getRepoTasksDir(args.repoRoot),
      sourcePath,
      destinationRootDir: getRepoTasksDir(args.repoRoot),
      destinationPath,
      sourceContent: content,
      destinationContent: updated,
    });
  }
  return {
    id: args.id,
    fromState: record.state,
    toState: args.toState,
    path: relative(args.repoRoot, destinationPath),
    previousPath: relative(args.repoRoot, sourcePath),
  };
}

export function moveTaskById(
  repoRoot: string,
  id: string,
  toState: RepoTaskState,
): MoveTaskResult {
  return transitionTask({ repoRoot, id, toState });
}

export function reopenTaskById(
  repoRoot: string,
  id: string,
  priority: RepoTaskPriority,
): MoveTaskResult {
  return transitionTask({ repoRoot, id, toState: "open", reopeningPriority: priority });
}

export type DaemonTaskDetail = {
  id: string;
  title: string;
  priority: RepoTaskPriority;
  body: string;
  waitingOnTasks: string[];
  inProgress: boolean;
};

export type DaemonTaskStatusResponse = {
  counts: { inbox: number; open: number; blocked: number };
  tasks: {
    open: DaemonTaskDetail[];
    blocked: DaemonTaskDetail[];
  };
};
