import {
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
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
export const REPO_INBOX_DIR = join(REPO_DATA_DIR, "inbox");

export {
  buildIndexableTaskText,
  extractTaskSections,
  INDEXABLE_TASK_SECTIONS,
} from "./repo-task-sections.js";

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
  promotableBacklogCount: number;
  dispatchableCount: number;
  hasDispatchableWork: boolean;
  dependencyBlockedTasks: RepoTaskDependencyWait[];
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
    typeof value.actionableCount === "number" &&
    "promotableBacklogCount" in value &&
    typeof value.promotableBacklogCount === "number" &&
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

export function getRepoInboxDir(repoRoot: string): string {
  return join(repoRoot, REPO_INBOX_DIR);
}

export function getRepoTaskStateDir(repoRoot: string, state: RepoTaskState): string {
  return join(getRepoTasksDir(repoRoot), state);
}

export function writeRepoTaskFile(
  repoRoot: string,
  filePath: string,
  content: string,
): void {
  writeRepoMarkdownFile({
    repoRoot,
    rootDir: getRepoTasksDir(repoRoot),
    filePath,
    content,
  });
}

export function writeRepoInboxFile(
  repoRoot: string,
  filePath: string,
  content: string,
): void {
  writeRepoMarkdownFile({
    repoRoot,
    rootDir: getRepoInboxDir(repoRoot),
    filePath,
    content,
  });
}

export function readRepoInboxFile(
  repoRoot: string,
  filePath: string,
): string | null {
  return readVerifiedRepoMarkdownFile({
    repoRoot,
    rootDir: getRepoInboxDir(repoRoot),
    filePath,
  });
}

export function removeRepoInboxFile(
  repoRoot: string,
  filePath: string,
): boolean {
  const inboxDir = getRepoInboxDir(repoRoot);
  if (
    readVerifiedRepoMarkdownFile({
      repoRoot,
      rootDir: inboxDir,
      filePath,
    }) === null
  ) {
    return false;
  }
  removeRepoMarkdownFile({
    repoRoot,
    rootDir: inboxDir,
    filePath,
  });
  return true;
}

export function countRepoTaskState(repoRoot: string, state: RepoTaskState): number {
  const dir = getRepoTaskStateDir(repoRoot, state);
  return listVerifiedRepoMarkdownFiles({
    repoRoot,
    rootDir: getRepoTasksDir(repoRoot),
    directoryPath: dir,
  }).filter((entry) => entry.name !== "AGENTS.md").length;
}

export function countRepoInboxEntries(repoRoot: string): number {
  const dir = getRepoInboxDir(repoRoot);
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter(
    (name) => name.endsWith(".md") && name !== "AGENTS.md",
  ).length;
}

export function getRepoTaskQueueSnapshot(
  repoRoot: string,
): RepoTaskQueueSnapshot {
  const counts = Object.fromEntries(
    REPO_TASK_STATES.map((state) => [state, countRepoTaskState(repoRoot, state)]),
  ) as Record<RepoTaskState, number>;
  const inboxCount = countRepoInboxEntries(repoRoot);
  const dependencyBlockedTasks = listRepoTaskDependencyWaits(repoRoot, [
    "backlog",
    "ready",
    "doing",
  ]);
  const dependencyBlockedByState = new Map<RepoTaskState, number>();
  for (const wait of dependencyBlockedTasks) {
    dependencyBlockedByState.set(
      wait.state,
      (dependencyBlockedByState.get(wait.state) ?? 0) + 1,
    );
  }
  const dependencyBlockedCount = (state: RepoTaskState): number =>
    dependencyBlockedByState.get(state) ?? 0;
  const actionableCount =
    counts.ready +
    counts.doing -
    dependencyBlockedCount("ready") -
    dependencyBlockedCount("doing");
  const waitingBacklogIds = new Set(
    dependencyBlockedTasks
      .filter((wait) => wait.state === "backlog")
      .map((wait) => wait.id),
  );
  const promotableBacklogCount = countRepoPromotableBacklogTasksWithWaits(
    repoRoot,
    waitingBacklogIds,
  );
  const dispatchableCount =
    inboxCount + actionableCount + promotableBacklogCount;

  return {
    counts,
    inboxCount,
    openCount:
      inboxCount +
      counts.backlog +
      counts.ready +
      counts.doing +
      counts.blocked,
    pullableCount: actionableCount + promotableBacklogCount,
    actionableCount,
    promotableBacklogCount,
    dispatchableCount,
    hasDispatchableWork: dispatchableCount > 0,
    dependencyBlockedTasks,
    headSha: getRepoHeadSha(repoRoot),
  };
}

export function countRepoPromotableBacklogTasks(repoRoot: string): number {
  const waitingIds = new Set(
    listRepoTaskDependencyWaits(repoRoot, ["backlog"]).map((wait) => wait.id),
  );
  return countRepoPromotableBacklogTasksWithWaits(repoRoot, waitingIds);
}

function countRepoPromotableBacklogTasksWithWaits(
  repoRoot: string,
  waitingIds: ReadonlySet<string>,
): number {
  return listFullRepoTasks(repoRoot, ["backlog"]).filter((record) =>
    !record.anchor && !waitingIds.has(record.id)
  ).length;
}

export function isThinDispatchableQueue(
  snapshot: RepoTaskQueueSnapshot,
  promotableBacklogCount = snapshot.promotableBacklogCount,
): boolean {
  const dependencyBlockedCount = (state: "ready" | "doing"): number =>
    snapshot.dependencyBlockedTasks.filter((task) => task.state === state).length;
  const readyTailCount = snapshot.counts.ready - dependencyBlockedCount("ready");
  const doingCount = snapshot.counts.doing - dependencyBlockedCount("doing");
  const dispatchableTailCount = readyTailCount + promotableBacklogCount;

  return (
    snapshot.inboxCount === 0 &&
    dispatchableTailCount <= 2 &&
    (dispatchableTailCount > 0 || doingCount > 0)
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

export type RepoTaskClass =
  | "Product"
  | "Safety"
  | "Platform"
  | "Meta"
  | "Unclassified";

/**
 * A full task record carrying every frontmatter field needed to render a
 * search hit, plus the raw body. Used by the `repo-tasks` provider seam to
 * answer search queries with metadata-rich hits without re-reading files.
 */
export type RepoTaskFullRecord = {
  id: string;
  title: string;
  state: RepoTaskState;
  priority: string;
  area: string;
  taskClass: RepoTaskClass;
  summary: string;
  updatedAt: string;
  body: string;
  /** Hard predecessor task ids declared in frontmatter `depends_on`. */
  dependsOn: string[];
  /**
   * Strategic backlog anchor. Anchors track an initiative across a sequenced
   * set of sub-slice tasks; their `Done When` is met by completing the
   * sub-slices, not by implementing the anchor as a single block. The
   * backlog-promoter skips anchors so they never land in `ready/`.
   */
  anchor: boolean;
};

export type RepoTaskFileDescriptor = {
  path: string;
  snapshot: FileSnapshot;
};

export type VerifiedRepoTaskFullRecord = RepoTaskFullRecord & {
  taskFile: RepoTaskFileDescriptor;
};

export function readVerifiedRepoTaskFile(
  repoRoot: string,
  state: RepoTaskState,
  id: string,
): ({ content: string } & RepoTaskFileDescriptor) | null {
  if (!isRepoTaskId(id)) {
    throw new Error(`Invalid task id: ${id}`);
  }
  const path = join(REPO_TASKS_DIR, state, `${id}.md`);
  const verified = readVerifiedRepoMarkdownFileWithIdentity({
    repoRoot,
    rootDir: getRepoTasksDir(repoRoot),
    filePath: join(repoRoot, path),
  });
  if (verified === null) return null;
  const { attrs } = parseFlatFrontMatter(verified.content);
  if (attrs.id !== id) {
    throw new Error(`Task entry ${path} does not declare its canonical id ${id}`);
  }
  return { path, content: verified.content, snapshot: verified.snapshot };
}

export type RepoTaskDependencyWait = {
  id: string;
  title: string;
  state: RepoTaskState;
  dependsOn: string[];
  waitingOn: string[];
};

/**
 * List every full task record across the requested states, reading the
 * normalized frontmatter fields the provider seam needs. Tasks missing
 * required frontmatter (id, title, status, updated_at) are skipped so
 * downstream callers can rely on strict shapes.
 */
export function listVerifiedFullRepoTasks(
  repoRoot: string,
  states: readonly RepoTaskState[] = REPO_TASK_STATES,
): VerifiedRepoTaskFullRecord[] {
  const tasksDir = getRepoTasksDir(repoRoot);
  const result: VerifiedRepoTaskFullRecord[] = [];
  for (const state of states) {
    const dir = join(tasksDir, state);
    for (const entry of listVerifiedRepoMarkdownFiles({
      repoRoot,
      rootDir: tasksDir,
      directoryPath: dir,
    })) {
      const { name, content, snapshot } = entry;
      if (name === "AGENTS.md") continue;
      const { attrs, body } = parseFlatFrontMatter(content);
      if (
        typeof attrs.id !== "string" ||
        typeof attrs.title !== "string" ||
        typeof attrs.updated_at !== "string"
      ) {
        continue;
      }
      const expectedName = `${attrs.id}.md`;
      if (name !== expectedName) {
        throw new Error(
          `Task entry ${join(REPO_TASKS_DIR, state, name)} must be named ${expectedName}`,
        );
      }
      const priority = typeof attrs.priority === "string" ? attrs.priority : "";
      const area = typeof attrs.area === "string" ? attrs.area : "";
      const summary = typeof attrs.summary === "string" ? attrs.summary : "";
      const taskClass = parseTaskClass(
        typeof attrs.task_class === "string" ? attrs.task_class : undefined,
      );
      result.push({
        id: attrs.id,
        title: attrs.title,
        state,
        priority,
        area,
        taskClass,
        summary,
        updatedAt: attrs.updated_at,
        body,
        dependsOn: readTaskDependencyIds(attrs),
        anchor: parseAnchorField(typeof attrs.anchor === "string" ? attrs.anchor : undefined),
        taskFile: {
          path: join(REPO_TASKS_DIR, state, name),
          snapshot,
        },
      });
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

export function listRepoTaskDependencyWaits(
  repoRoot: string,
  states: readonly RepoTaskState[] = REPO_TASK_STATES,
): RepoTaskDependencyWait[] {
  const allTasks = listFullRepoTasks(repoRoot);
  const stateByTaskId = new Map(allTasks.map((task) => [task.id, task.state]));
  const wanted = new Set(states);
  return allTasks
    .filter((task) => wanted.has(task.state))
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

/**
 * Parse the optional `anchor` frontmatter field. Only the literal `true`
 * marks a task as a strategic anchor; everything else (absent, `false`,
 * malformed) is treated as a normal task.
 */
function parseAnchorField(raw: string | undefined): boolean {
  return raw?.trim().toLowerCase() === "true";
}

function parseTaskClass(raw: string | undefined): RepoTaskClass {
  switch (raw) {
    case "Product":
    case "Safety":
    case "Platform":
    case "Meta":
      return raw;
    case undefined:
      return "Unclassified";
  }
  return "Unclassified";
}

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
  repoRoot: string,
  state: RepoTaskState,
): RepoTaskRecord[] {
  const dir = getRepoTaskStateDir(repoRoot, state);
  const records: RepoTaskRecord[] = [];
  for (const entry of listVerifiedRepoMarkdownFiles({
    repoRoot,
    rootDir: getRepoTasksDir(repoRoot),
    directoryPath: dir,
  })) {
    if (entry.name === "AGENTS.md") continue;
    const content = entry.content;
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
 * Move a normalized task file between state directories, updating the
 * `status` and `updated_at` frontmatter fields.
 *
 * This is the single filesystem mechanism for state transitions. Workflow
 * callers invoke it inside their sandbox; external canonical callers first
 * pass through the repo-task mutation boundary. Throws when the task is not
 * found, is already in the target state, or when the file operation fails.
 */
export function moveTaskById(
  repoRoot: string,
  id: string,
  toState: RepoTaskState,
): MoveTaskResult {
  if (!isRepoTaskId(id)) {
    throw new Error("Invalid task id");
  }

  const tasksDir = getRepoTasksDir(repoRoot);
  let fromState: RepoTaskState | null = null;
  let fromPath: string | null = null;
  let content: string | null = null;
  for (const state of REPO_TASK_STATES) {
    const candidate = join(tasksDir, state, `${id}.md`);
    const candidateContent = readVerifiedRepoMarkdownFile({
      repoRoot,
      rootDir: tasksDir,
      filePath: candidate,
    });
    if (candidateContent !== null) {
      fromState = state;
      fromPath = candidate;
      content = candidateContent;
      break;
    }
  }
  if (!fromState || !fromPath || content === null) {
    throw new Error(`Task "${id}" not found in any state directory`);
  }
  if (fromState === toState) {
    throw new Error(`Task "${id}" is already in "${toState}"`);
  }
  const dstPath = join(tasksDir, toState, `${id}.md`);
  if (
    readVerifiedRepoMarkdownFile({
      repoRoot,
      rootDir: tasksDir,
      filePath: dstPath,
    }) !== null
  ) {
    throw new Error(`Task "${id}" already exists in "${toState}"`);
  }
  const { attrs, body } = parseFlatFrontMatter(content);
  attrs.status = toState;
  attrs.updated_at = new Date().toISOString();
  const updated = serializeFlatFrontMatter(attrs, body);

  moveRepoMarkdownFile({
    repoRoot,
    sourceRootDir: tasksDir,
    sourcePath: fromPath,
    destinationRootDir: tasksDir,
    destinationPath: dstPath,
    sourceContent: content,
    destinationContent: updated,
  });

  return {
    id,
    fromState,
    toState,
    path: dstPath.slice(repoRoot.length + 1),
    previousPath: fromPath.slice(repoRoot.length + 1),
  };
}

export type DaemonTaskDetail = {
  id: string;
  title: string;
  priority: string;
  area: string;
  summary: string;
  body: string;
  waitingOnTasks: string[];
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
