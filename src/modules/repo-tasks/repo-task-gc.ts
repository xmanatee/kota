import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import type {
  RepoTaskGcOptions,
  RepoTaskGcResult,
  RepoTaskState,
} from "./client.js";
import {
  moveAndStageRepoMarkdownFile,
  readVerifiedRepoMarkdownFile,
  removeAndStageRepoMarkdownFile,
  stageRepoPaths,
} from "./repo-file-mutations.js";
import { getRepoTasksDir } from "./repo-tasks-domain.js";

const TERMINAL_STATES: RepoTaskState[] = ["done", "dropped"];

/** Archive or delete terminal tasks older than the requested threshold. */
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
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter(
      (file) => file.endsWith(".md") && file !== "AGENTS.md",
    );
    for (const file of files) {
      const filePath = join(dir, file);
      const content = readVerifiedRepoMarkdownFile({
        projectDir,
        rootDir: tasksDir,
        filePath,
      });
      if (content === null) continue;
      const { attrs } = parseFlatFrontMatter(content);
      const raw = attrs.updated_at;
      const updatedAt = raw ? new Date(String(raw)) : null;
      if (
        !updatedAt ||
        Number.isNaN(updatedAt.getTime()) ||
        updatedAt >= cutoff
      ) {
        continue;
      }
      if (deleteMode) {
        if (!dryRun) {
          removeAndStageRepoMarkdownFile({
            projectDir,
            rootDir: tasksDir,
            filePath,
            stage: () => stageRepoPaths(projectDir, [filePath]),
          });
        }
        deleted.push(file);
        continue;
      }
      if (!dryRun) {
        moveAndStageRepoMarkdownFile({
          projectDir,
          sourceRootDir: tasksDir,
          sourcePath: filePath,
          destinationRootDir: archiveDir,
          destinationPath: join(archiveDir, file),
          sourceContent: content,
          destinationContent: content,
          stage: () => stageRepoPaths(projectDir, [filePath]),
        });
      }
      archived.push(file);
    }
  }

  return { archived, deleted };
}
