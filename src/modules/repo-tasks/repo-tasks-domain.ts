import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFlatFrontMatter, serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import { getRepoHeadSha } from "#core/util/repo-worktree.js";
import {
  findUnfinishedTaskDependencies,
  readTaskDependencyIds,
} from "./task-dependencies.js";

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
    "dependencyBlockedTasks" in value &&
    Array.isArray(value.dependencyBlockedTasks)
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
  const dependencyBlockedTasks = listRepoTaskDependencyWaits(projectDir, [
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

  return {
    counts,
    inboxCount,
    openCount:
      inboxCount +
      counts.backlog +
      counts.ready +
      counts.doing +
      counts.blocked,
    pullableCount:
      counts.backlog +
      counts.ready +
      counts.doing -
      dependencyBlockedCount("backlog") -
      dependencyBlockedCount("ready") -
      dependencyBlockedCount("doing"),
    actionableCount:
      counts.ready +
      counts.doing -
      dependencyBlockedCount("ready") -
      dependencyBlockedCount("doing"),
    dependencyBlockedTasks,
    headSha: getRepoHeadSha(projectDir),
  };
}

export function countRepoPromotableBacklogTasks(projectDir: string): number {
  const waitingIds = new Set(
    listRepoTaskDependencyWaits(projectDir, ["backlog"]).map((wait) => wait.id),
  );
  return listFullRepoTasks(projectDir, ["backlog"]).filter((record) =>
    !record.anchor && !waitingIds.has(record.id)
  ).length;
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

export type RepoTaskDependencyWait = {
  id: string;
  title: string;
  state: RepoTaskState;
  dependsOn: string[];
  waitingOn: string[];
};

/** Indexable body sections: title and summary plus these markdown sections. */
export const INDEXABLE_TASK_SECTIONS = [
  "Problem",
  "Desired Outcome",
  "Constraints",
  "Source / Intent",
  "Initiative",
] as const;

/**
 * Extract the configured indexable text for a task: title, summary, and the
 * `## Problem`, `## Desired Outcome`, `## Constraints`, `## Source / Intent`,
 * and `## Initiative` body sections joined into a single string. `## Plan`
 * and `## Acceptance Evidence` are skipped because they churn faster than
 * the task's intent.
 */
export function buildIndexableTaskText(record: RepoTaskFullRecord): string {
  const parts: string[] = [];
  if (record.title) parts.push(record.title);
  if (record.summary) parts.push(record.summary);
  const sections = extractTaskSections(
    record.body,
    INDEXABLE_TASK_SECTIONS as unknown as readonly string[],
  );
  for (const heading of INDEXABLE_TASK_SECTIONS) {
    const body = sections[heading];
    if (body) parts.push(body.trim());
  }
  return parts.join("\n\n").trim();
}

/**
 * Parse `## Heading` sections out of a task body, returning each requested
 * section keyed by heading. Headings are matched case-sensitively at the
 * start of a line. A section ends at the next `## ` heading or at end of body.
 */
export function extractTaskSections(
  body: string,
  headings: readonly string[],
): Record<string, string> {
  const wanted = new Set(headings);
  const lines = body.split(/\r?\n/);
  const result: Record<string, string> = {};
  let currentHeading: string | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (currentHeading) {
      result[currentHeading] = buffer.join("\n").trim();
    }
    buffer = [];
    currentHeading = null;
  };
  for (const line of lines) {
    const match = /^##\s+(.+)\s*$/.exec(line);
    if (match) {
      flush();
      const heading = match[1].trim();
      if (wanted.has(heading)) {
        currentHeading = heading;
      }
      continue;
    }
    if (currentHeading) buffer.push(line);
  }
  flush();
  return result;
}

/**
 * List every full task record across the requested states, reading the
 * normalized frontmatter fields the provider seam needs. Tasks missing
 * required frontmatter (id, title, status, updated_at) are skipped so
 * downstream callers can rely on strict shapes.
 */
export function listFullRepoTasks(
  projectDir: string,
  states: readonly RepoTaskState[] = REPO_TASK_STATES,
): RepoTaskFullRecord[] {
  const tasksDir = getRepoTasksDir(projectDir);
  const result: RepoTaskFullRecord[] = [];
  for (const state of states) {
    const dir = join(tasksDir, state);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".md") || name === "AGENTS.md") continue;
      const filePath = join(dir, name);
      let content: string;
      try {
        content = readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }
      const { attrs, body } = parseFlatFrontMatter(content);
      if (
        typeof attrs.id !== "string" ||
        typeof attrs.title !== "string" ||
        typeof attrs.updated_at !== "string"
      ) {
        continue;
      }
      const priority = typeof attrs.priority === "string" ? attrs.priority : "";
      const area = typeof attrs.area === "string" ? attrs.area : "";
      const summary = typeof attrs.summary === "string" ? attrs.summary : "";
      result.push({
        id: attrs.id,
        title: attrs.title,
        state,
        priority,
        area,
        summary,
        updatedAt: attrs.updated_at,
        body,
        dependsOn: readTaskDependencyIds(attrs),
        anchor: parseAnchorField(typeof attrs.anchor === "string" ? attrs.anchor : undefined),
      });
    }
  }
  return result;
}

export function listRepoTaskDependencyWaits(
  projectDir: string,
  states: readonly RepoTaskState[] = REPO_TASK_STATES,
): RepoTaskDependencyWait[] {
  const allTasks = listFullRepoTasks(projectDir);
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
  projectDir: string,
  dependencies: readonly string[],
): string[] {
  const stateByTaskId = new Map(
    listFullRepoTasks(projectDir).map((task) => [task.id, task.state]),
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
