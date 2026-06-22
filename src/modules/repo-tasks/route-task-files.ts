import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import type { DaemonTaskDetail } from "./repo-tasks-domain.js";
import {
  listRepoTaskDependencyWaits,
  type RepoTaskState,
} from "./repo-tasks-domain.js";

export const COUNTED_STATES = ["inbox", "ready", "backlog", "doing", "blocked"] as const;
export const DETAIL_STATES = ["doing", "ready", "backlog", "blocked"] as const;

const OPEN_STATES: readonly RepoTaskState[] = ["backlog", "ready", "doing", "blocked"];

function isMissingPathError(error: Error): boolean {
  if (!("code" in error)) {
    return false;
  }
  return error.code === "ENOENT" || error.code === "ENOTDIR";
}

export function listTaskFiles(tasksDir: string, state: string): string[] {
  const dir = join(tasksDir, state);
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "AGENTS.md");
  } catch (error) {
    if (error instanceof Error && isMissingPathError(error)) {
      return [];
    }
    throw error;
  }
}

export function countMarkdownFiles(dir: string): number {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "AGENTS.md").length;
  } catch (error) {
    if (error instanceof Error && isMissingPathError(error)) {
      return 0;
    }
    throw error;
  }
}

export function tryReadUtf8(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch (error) {
    if (error instanceof Error && isMissingPathError(error)) {
      return null;
    }
    throw error;
  }
}

export function readStateTasks(
  projectDir: string,
  tasksDir: string,
  state: RepoTaskState,
): DaemonTaskDetail[] {
  const waitingById = new Map(
    listRepoTaskDependencyWaits(projectDir, [state]).map((wait) => [
      wait.id,
      wait.waitingOn,
    ]),
  );
  const result: DaemonTaskDetail[] = [];
  for (const file of listTaskFiles(tasksDir, state)) {
    const content = tryReadUtf8(join(tasksDir, state, file));
    if (content === null) continue;
    const { attrs, body } = parseFlatFrontMatter(content);
    if (typeof attrs.id !== "string" || typeof attrs.title !== "string") {
      continue;
    }
    result.push({
      id: attrs.id,
      title: attrs.title,
      priority: typeof attrs.priority === "string" ? attrs.priority : "",
      area: typeof attrs.area === "string" ? attrs.area : "",
      summary: typeof attrs.summary === "string" ? attrs.summary : "",
      body: body.trim(),
      waitingOnTasks: waitingById.get(attrs.id) ?? [],
    });
  }
  return result;
}

export function findTaskInOpenStates(
  tasksDir: string,
  id: string,
): { state: RepoTaskState; filename: string; content: string } | null {
  for (const state of OPEN_STATES) {
    for (const file of listTaskFiles(tasksDir, state)) {
      const content = tryReadUtf8(join(tasksDir, state, file));
      if (content === null) continue;
      const { attrs } = parseFlatFrontMatter(content);
      if (attrs.id === id) return { state, filename: file, content };
    }
  }
  return null;
}

export function updateStatusFrontmatter(content: string, newStatus: string): string {
  return content.replace(/^(status:\s*)\S+/m, `$1${newStatus}`);
}
