/**
 * Shared mutation logic for task create, capture, show, move, and body updates.
 *
 * Optional local-client and HTTP helpers share these operations. Agents can
 * author complete task Markdown directly in their supplied workspace.
 */
import { join, relative } from "node:path";
import type { RepoTasksProvider } from "#core/modules/provider-types.js";
import { parseFlatFrontMatter, serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import type {
  RepoTaskCaptureResult,
  RepoTaskCreateOptions,
  RepoTaskCreateResult,
  RepoTaskListResult,
  RepoTaskReindexResult,
  RepoTaskSearchFilter,
  RepoTaskSearchResult,
  RepoTaskShowResult,
  RepoTaskState,
  RepoTaskUpdateBodyResult,
} from "./client.js";
import { readVerifiedRepoMarkdownFile } from "./repo-file-mutations.js";
import {
  getRepoInboxDir,
  getRepoTaskPath,
  getRepoTasksDir,
  listFullRepoTasks,
  listRepoTaskDependencyWaits,
  listVerifiedFullRepoTasks,
  writeRepoInboxFile,
  writeRepoTaskFile,
} from "./repo-tasks-domain.js";
import { isRepoTaskId } from "./task-id.js";
import { validateTaskBody } from "./task-queue-validation.js";
import { inspectRepoWorkSupply, resolveRepoWorkSupplyInput } from "./work-supply.js";

const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_LIST_STATES: RepoTaskState[] = ["open", "blocked"];

export function listRepoTasks(
  repoRoot: string,
  states?: RepoTaskState[],
): RepoTaskListResult {
  const selectedStates = states && states.length > 0 ? states : DEFAULT_LIST_STATES;
  const waitingById = new Map(
    listRepoTaskDependencyWaits(repoRoot).map((wait) => [wait.id, wait.waitingOn]),
  );
  return {
    workSupply: inspectRepoWorkSupply(resolveRepoWorkSupplyInput({ workspaceRoot: repoRoot, scopeRoot: repoRoot, stateDir: join(repoRoot, ".kota") })),
    tasks: listFullRepoTasks(repoRoot, selectedStates).map((task) => ({
      id: task.id,
      priority: task.priority,
      title: task.title,
      state: task.state,
      waitingOnTasks: waitingById.get(task.id) ?? [],
    })),
  };
}

export async function searchRepoTasks(
  provider: RepoTasksProvider,
  keywordProvider: RepoTasksProvider,
  query: string,
  filter?: RepoTaskSearchFilter,
): Promise<RepoTaskSearchResult> {
  const options = {
    topK: filter?.limit ?? DEFAULT_SEARCH_LIMIT,
    ...(filter?.states && filter.states.length > 0 ? { states: filter.states } : {}),
  };
  if (filter?.semantic === false) {
    return { ok: true, tasks: await keywordProvider.searchTasks(query, options) };
  }
  const semantic = provider.semanticSearchCapability;
  if (!semantic) return { ok: false, reason: "semantic_unavailable" };
  try {
    return { ok: true, tasks: await semantic.searchTasks(query, options) };
  } catch {
    return { ok: false, reason: "semantic_unavailable" };
  }
}

export async function reindexRepoTasks(
  provider: RepoTasksProvider,
): Promise<RepoTaskReindexResult> {
  const semantic = provider.semanticSearchCapability;
  if (!semantic) return { ok: false, reason: "semantic_unavailable" };
  return { ok: true, ...await semantic.reindex() };
}

/**
 * Slugify a task title into a stable kebab-case suffix used in filenames.
 *
 * The CLI inbox convenience and client contract use this shape so
 * `kota task capture "Fix auth"` produces `task-fix-auth.md` deterministically
 * and the duplicate check is meaningful.
 */
export function slugifyTaskTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 50)
    .replace(/-+$/, "");
}

/** Read a normalized task by its filename-derived id. */
export function showTask(repoRoot: string, id: string): RepoTaskShowResult {
  if (!isRepoTaskId(id)) {
    return { found: false };
  }

  const record = listVerifiedFullRepoTasks(repoRoot).find((task) => task.id === id);
  if (!record) return { found: false };
  const content = readVerifiedRepoMarkdownFile({
    repoRoot,
    rootDir: getRepoTasksDir(repoRoot),
    filePath: join(repoRoot, record.taskFile.path),
  });
  return content === null ? { found: false } : { found: true, state: record.state, content };
}

/** Replace a non-terminal task's markdown body through the path-safe domain writer. */
export function updateTaskBody(
  repoRoot: string,
  id: string,
  body: string,
): RepoTaskUpdateBodyResult {
  if (!isRepoTaskId(id)) return { ok: false, reason: "invalid_id" };
  const record = listVerifiedFullRepoTasks(repoRoot).find((task) => task.id === id);
  if (!record) return { ok: false, reason: "not_found" };
  if (record.state === "done" || record.state === "dropped") {
    return { ok: false, reason: "terminal" };
  }
  const filePath = join(repoRoot, record.taskFile.path);
  const content = readVerifiedRepoMarkdownFile({
    repoRoot,
    rootDir: getRepoTasksDir(repoRoot),
    filePath,
  });
  if (content === null) return { ok: false, reason: "not_found" };
  if (validateTaskBody(body, record.state).length > 0) return { ok: false, reason: "malformed" };
  const { attrs } = parseFlatFrontMatter(content);
  const nextContent = serializeFlatFrontMatter(attrs, body.trim());
  writeRepoTaskFile(repoRoot, filePath, nextContent);
  return { ok: true, id, state: record.state, content: nextContent };
}

/** Create a complete authored task in one domain write. */
export function createNormalizedTask(
  repoRoot: string,
  options: RepoTaskCreateOptions,
): RepoTaskCreateResult {
  if (typeof options.body !== "string") {
    return {
      ok: false,
      reason: "invalid_body",
      message: "A complete task body is required. Capture rough ideas in the inbox.",
    };
  }
  const slug = slugifyTaskTitle(options.title);
  if (!slug) {
    return {
      ok: false,
      reason: "invalid_slug",
      message: "Title produced an empty slug. Use a more descriptive title.",
    };
  }

  const id = `task-${slug}`;
  const state = options.state ?? "open";
  const body = `# ${options.title}\n\n${options.body}`;
  const bodyFindings = validateTaskBody(body, state);
  if (bodyFindings.length > 0) {
    return {
      ok: false,
      reason: "invalid_body",
      message: bodyFindings.map(({ message }) => `Task ${message}.`).join(" "),
    };
  }
  const filePath = getRepoTaskPath(repoRoot, state, id);

  if (
    readVerifiedRepoMarkdownFile({
      repoRoot,
      rootDir: getRepoTasksDir(repoRoot),
      filePath,
    }) !== null
  ) {
    return {
      ok: false,
      reason: "already_exists",
      message: `Task file "${id}.md" already exists.`,
    };
  }

  const attrs: Record<string, string> = {
    status: state,
    priority: options.priority,
  };

  writeRepoTaskFile(
    repoRoot,
    filePath,
    serializeFlatFrontMatter(attrs, body),
  );
  return { ok: true, id, path: relative(repoRoot, filePath) };
}

/**
 * Quick inbox capture (no random suffix, fail on duplicate). Used by both the
 * CLI `task capture` and the matching daemon HTTP route.
 */
export function captureInboxTask(
  repoRoot: string,
  title: string,
): RepoTaskCaptureResult {
  const slug = slugifyTaskTitle(title);
  if (!slug) {
    return {
      ok: false,
      reason: "invalid_slug",
      message: "Title produced an empty slug. Use a more descriptive title.",
    };
  }

  const id = `task-${slug}`;
  const inboxDir = getRepoInboxDir(repoRoot);
  const filePath = join(inboxDir, `${id}.md`);

  if (
    readVerifiedRepoMarkdownFile({
      repoRoot,
      rootDir: inboxDir,
      filePath,
    }) !== null
  ) {
    return {
      ok: false,
      reason: "already_exists",
      message: `Inbox file "${id}.md" already exists.`,
    };
  }

  writeRepoInboxFile(repoRoot, filePath, `# ${title}\n`);
  return { ok: true, id, path: relative(repoRoot, filePath) };
}
