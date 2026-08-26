/**
 * Shared mutation logic for `kota task create / capture / show / move / gc`.
 *
 * Both the CLI subcommands (via the local-client handler) and the daemon
 * HTTP routes route through these functions so the two transports cannot
 * diverge in behavior.
 */
import {
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { parseFlatFrontMatter, serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import type {
  RepoTaskCaptureResult,
  RepoTaskCreateOptions,
  RepoTaskCreateResult,
  RepoTaskShowResult,
  RepoTaskUpdateBodyResult,
} from "./client.js";
import { readVerifiedRepoMarkdownFile } from "./repo-file-mutations.js";
import { renderRepoTaskIntent } from "./repo-task-intent.js";
import {
  getRepoInboxDir,
  getRepoTasksDir,
  REPO_TASK_STATES,
  writeRepoInboxFile,
  writeRepoTaskFile,
} from "./repo-tasks-domain.js";
import { isRepoTaskId } from "./task-id.js";

/**
 * Slugify a task title into a stable kebab-case suffix used in filenames.
 *
 * Distinct from the random-suffix slug used by the public `POST /api/tasks`
 * inbox route (kept for the web UI). The CLI and contract use this shape so
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

/** Read a normalized task by id, scanning every state directory. */
export function showTask(projectDir: string, id: string): RepoTaskShowResult {
  if (!isRepoTaskId(id)) {
    return { found: false };
  }

  const tasksDir = getRepoTasksDir(projectDir);
  for (const state of REPO_TASK_STATES) {
    const filePath = join(tasksDir, state, `${id}.md`);
    const content = readVerifiedRepoMarkdownFile({
      projectDir,
      rootDir: tasksDir,
      filePath,
    });
    if (content !== null) {
      return {
        found: true,
        state,
        content,
      };
    }
  }
  return { found: false };
}

/** Replace a non-terminal task's markdown body through the path-safe domain writer. */
export function updateTaskBody(
  projectDir: string,
  id: string,
  body: string,
): RepoTaskUpdateBodyResult {
  if (!isRepoTaskId(id)) return { ok: false, reason: "invalid_id" };
  const tasksDir = getRepoTasksDir(projectDir);
  for (const state of REPO_TASK_STATES) {
    const stateDir = join(tasksDir, state);
    if (!existsSync(stateDir)) continue;
    for (const file of readdirSync(stateDir)) {
      if (!file.endsWith(".md") || file === "AGENTS.md") continue;
      const filePath = join(stateDir, file);
      const content = readVerifiedRepoMarkdownFile({
        projectDir,
        rootDir: tasksDir,
        filePath,
      });
      if (content === null) continue;
      if (parseFlatFrontMatter(content).attrs.id !== id) continue;
      if (state === "done" || state === "dropped") {
        return { ok: false, reason: "terminal" };
      }
      const frontMatter = content.match(/^(---\r?\n[\s\S]*?\r?\n---)\r?\n[\s\S]*$/)?.[1];
      if (!frontMatter) return { ok: false, reason: "malformed" };
      const updatedAt = new Date().toISOString();
      const updatedFrontMatter = /^(updated_at:\s*)\S+/m.test(frontMatter)
        ? frontMatter.replace(/^(updated_at:\s*)\S+/m, `$1${updatedAt}`)
        : frontMatter.replace(/\r?\n---$/, `\nupdated_at: ${updatedAt}\n---`);
      const nextContent = `${updatedFrontMatter}\n\n${body.trim()}\n`;
      writeRepoTaskFile(projectDir, filePath, nextContent);
      return { ok: true, id, state, content: nextContent };
    }
  }
  return { ok: false, reason: "not_found" };
}

function buildNormalizedTaskBody(): string {
  return renderRepoTaskIntent({
    problem: "Describe the problem and why it matters.",
    desiredOutcome: "Describe the observable outcome, without prescribing an implementation.",
    constraints: "Name only constraints that materially limit a valid solution.",
    howWeWillKnow: "Describe the behavior or observation that will make completion credible.",
  });
}

/**
 * Create a normalized task file with the recommended intent scaffold. Used by both the CLI
 * `task create` and the matching daemon HTTP route.
 */
export function createNormalizedTask(
  projectDir: string,
  options: RepoTaskCreateOptions,
): RepoTaskCreateResult {
  const slug = slugifyTaskTitle(options.title);
  if (!slug) {
    return {
      ok: false,
      reason: "invalid_slug",
      message: "Title produced an empty slug. Use a more descriptive title.",
    };
  }

  const id = `task-${slug}`;
  const tasksDir = getRepoTasksDir(projectDir);
  const stateDir = join(tasksDir, options.state);
  const filePath = join(stateDir, `${id}.md`);

  if (
    readVerifiedRepoMarkdownFile({
      projectDir,
      rootDir: tasksDir,
      filePath,
    }) !== null
  ) {
    return {
      ok: false,
      reason: "already_exists",
      message: `Task file "${id}.md" already exists in ${options.state}/.`,
    };
  }

  const now = new Date().toISOString();
  const attrs: Record<string, string> = {
    id,
    title: options.title,
    status: options.state,
    priority: options.priority,
    area: options.area,
    summary: options.summary ?? "",
    created_at: now,
    updated_at: now,
  };

  writeRepoTaskFile(
    projectDir,
    filePath,
    serializeFlatFrontMatter(attrs, buildNormalizedTaskBody()),
  );
  return { ok: true, id, path: filePath };
}

/**
 * Quick inbox capture (no random suffix, fail on duplicate). Used by both the
 * CLI `task capture` and the matching daemon HTTP route.
 */
export function captureInboxTask(
  projectDir: string,
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
  const inboxDir = getRepoInboxDir(projectDir);
  const filePath = join(inboxDir, `${id}.md`);

  if (
    readVerifiedRepoMarkdownFile({
      projectDir,
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

  writeRepoInboxFile(projectDir, filePath, `# ${title}\n`);
  return { ok: true, id, path: filePath };
}

export { gcTerminalTasks } from "./repo-task-gc.js";
