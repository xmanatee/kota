/**
 * Shared mutation logic for `kota task create / capture / show / move / gc`.
 *
 * Both the CLI subcommands (via the local-client handler) and the daemon
 * HTTP routes route through these functions so the two transports cannot
 * diverge in behavior.
 */
import { execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseFlatFrontMatter, serializeFlatFrontMatter } from "#core/util/frontmatter.js";
import type {
  RepoTaskCaptureResult,
  RepoTaskCreateOptions,
  RepoTaskCreateResult,
  RepoTaskGcOptions,
  RepoTaskGcResult,
  RepoTaskShowResult,
  RepoTaskState,
} from "./client.js";
import {
  getRepoInboxDir,
  getRepoTasksDir,
  REPO_TASK_STATES,
  TASK_ACCEPTANCE_EVIDENCE_PLACEHOLDER,
  TASK_INITIATIVE_PLACEHOLDER,
  TASK_SOURCE_INTENT_PLACEHOLDER,
} from "./repo-tasks-domain.js";

const TERMINAL_STATES: RepoTaskState[] = ["done", "dropped"];

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
    .slice(0, 50);
}

/** Read a normalized task by id, scanning every state directory. */
export function showTask(projectDir: string, id: string): RepoTaskShowResult {
  const tasksDir = getRepoTasksDir(projectDir);
  for (const state of REPO_TASK_STATES) {
    const filePath = join(tasksDir, state, `${id}.md`);
    if (existsSync(filePath)) {
      return {
        found: true,
        state,
        content: readFileSync(filePath, "utf-8"),
      };
    }
  }
  return { found: false };
}

function buildNormalizedTaskBody(): string {
  return [
    "",
    "## Problem",
    "",
    "## Desired Outcome",
    "",
    "## Constraints",
    "",
    "## Done When",
    "",
    "## Source / Intent",
    "",
    TASK_SOURCE_INTENT_PLACEHOLDER,
    "",
    "## Initiative",
    "",
    TASK_INITIATIVE_PLACEHOLDER,
    "",
    "## Acceptance Evidence",
    "",
    TASK_ACCEPTANCE_EVIDENCE_PLACEHOLDER,
    "",
  ].join("\n");
}

/**
 * Create a normalized task file with the full template. Used by both the CLI
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
  mkdirSync(stateDir, { recursive: true });
  const filePath = join(stateDir, `${id}.md`);

  if (existsSync(filePath)) {
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

  writeFileSync(filePath, serializeFlatFrontMatter(attrs, buildNormalizedTaskBody()), "utf-8");
  try {
    execSync(`git add "${filePath}"`, { cwd: projectDir });
  } catch {
    // Caller's responsibility: the file is on disk; staging is best effort.
  }
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
  mkdirSync(inboxDir, { recursive: true });
  const filePath = join(inboxDir, `${id}.md`);

  if (existsSync(filePath)) {
    return {
      ok: false,
      reason: "already_exists",
      message: `Inbox file "${id}.md" already exists.`,
    };
  }

  writeFileSync(filePath, `# ${title}\n`, "utf-8");
  return { ok: true, id, path: filePath };
}

/**
 * Archive or delete terminal tasks (`done`, `dropped`) older than `days`.
 * Used by both the CLI `task gc` and the matching daemon HTTP route.
 */
export function gcTerminalTasks(
  projectDir: string,
  options: RepoTaskGcOptions = {},
): RepoTaskGcResult {
  const days = options.days ?? 30;
  const deleteMode = options.delete ?? false;
  const dryRun = options.dryRun ?? false;
  const tasksDir = getRepoTasksDir(projectDir);
  const archiveDir = join(projectDir, ".kota", "task-archive");
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const archived: string[] = [];
  const deleted: string[] = [];

  for (const state of TERMINAL_STATES) {
    const dir = join(tasksDir, state);
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "AGENTS.md");
    } catch {
      continue;
    }
    for (const file of files) {
      const filePath = join(dir, file);
      let updatedAt: Date | null = null;
      try {
        const content = readFileSync(filePath, "utf-8");
        const { attrs } = parseFlatFrontMatter(content);
        const raw = attrs.updated_at;
        if (raw) updatedAt = new Date(String(raw));
      } catch {
        continue;
      }
      if (!updatedAt || Number.isNaN(updatedAt.getTime()) || updatedAt >= cutoff) continue;
      if (deleteMode) {
        if (!dryRun) rmSync(filePath);
        deleted.push(file);
      } else {
        if (!dryRun) {
          mkdirSync(archiveDir, { recursive: true });
          renameSync(filePath, join(archiveDir, file));
        }
        archived.push(file);
      }
    }
  }

  return { archived, deleted };
}
