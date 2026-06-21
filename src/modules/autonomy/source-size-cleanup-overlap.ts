import {
  listFullRepoTasks,
  type RepoTaskFullRecord,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import type { SourceFileSizeWarning } from "./source-size-check.js";

export type SourceFileSizeOpenCleanupOverlap = {
  kind: "open-cleanup-overlap";
  files: string[];
  taskIds: string[];
  message: string;
};

function normalizePath(file: string): string {
  return file.replace(/\\/g, "/").trim();
}

function uniq(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sourceSizeTaskText(task: Pick<RepoTaskFullRecord, "title" | "summary" | "body">): string {
  return `${task.title}\n${task.summary}\n${task.body}`.toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsTaskTextToken(text: string, token: string): boolean {
  const escaped = escapeRegExp(token.toLowerCase());
  return new RegExp(`(^|[^A-Za-z0-9_./-])${escaped}($|[^A-Za-z0-9_./-])`).test(text);
}

function pathDirectory(file: string): string | null {
  const index = file.lastIndexOf("/");
  return index > 0 ? file.slice(0, index) : null;
}

function pathBasename(file: string): string {
  const index = file.lastIndexOf("/");
  return index >= 0 ? file.slice(index + 1) : file;
}

function sourceSizeTaskMentionsWarningFile(text: string, file: string): boolean {
  const normalizedFile = normalizePath(file).toLowerCase();
  if (containsTaskTextToken(text, normalizedFile)) return true;

  const directory = pathDirectory(normalizedFile);
  if (!directory || !text.includes(`${directory}/`)) return false;
  return containsTaskTextToken(text, pathBasename(normalizedFile));
}

function isSourceSizeCleanupTask(task: Pick<RepoTaskFullRecord, "title" | "summary" | "body">): boolean {
  return /\b(source[- ]file[- ]size|source[- ]size|oversized)\b/i.test(sourceSizeTaskText(task));
}

export function findOpenCleanupOverlap(
  projectDir: string,
  warnings: readonly SourceFileSizeWarning[],
): SourceFileSizeOpenCleanupOverlap | null {
  const warningFiles = warnings.map((warning) => normalizePath(warning.file));
  const taskIds: string[] = [];
  const files: string[] = [];
  for (const task of listFullRepoTasks(projectDir, ["backlog", "ready", "doing", "blocked"])) {
    if (!isSourceSizeCleanupTask(task)) continue;
    const text = sourceSizeTaskText(task);
    const matchedFiles = warningFiles.filter((file) =>
      sourceSizeTaskMentionsWarningFile(text, file)
    );
    if (matchedFiles.length === 0) continue;
    taskIds.push(task.id);
    files.push(...matchedFiles);
  }
  if (files.length === 0) return null;
  const uniqueFiles = uniq(files);
  return {
    kind: "open-cleanup-overlap",
    files: uniqueFiles,
    taskIds: uniq(taskIds),
    message:
      `Source-size warnings overlap existing cleanup task(s): ${uniq(taskIds).join(", ")} ` +
      `for ${uniqueFiles.join(", ")}.`,
  };
}
