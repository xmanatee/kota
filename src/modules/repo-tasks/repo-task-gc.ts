import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseFlatFrontMatter } from "#core/util/frontmatter.js";
import type {
  RepoTaskGcOptions,
  RepoTaskGcResult,
  RepoTaskState,
} from "./client.js";
import { readVerifiedRepoMarkdownFile, removeRepoMarkdownFile } from "./repo-file-mutations.js";
import { getRepoTasksDir } from "./repo-tasks-domain.js";

const TERMINAL_STATES: RepoTaskState[] = ["done", "dropped"];

/** Remove old terminal tasks; Git history is the default archive. */
export function gcTerminalTasks(
  repoRoot: string,
  options: RepoTaskGcOptions = {},
): RepoTaskGcResult {
  const days = options.days ?? 30;
  const dryRun = options.dryRun ?? false;
  const tasksDir = getRepoTasksDir(repoRoot);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const removed: string[] = [];

  for (const state of TERMINAL_STATES) {
    const dir = join(tasksDir, state);
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter(
      (file) => file.endsWith(".md") && file !== "AGENTS.md",
    );
    for (const file of files) {
      const filePath = join(dir, file);
      const content = readVerifiedRepoMarkdownFile({
        repoRoot,
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
      if (!dryRun) {
        removeRepoMarkdownFile({
          repoRoot,
          rootDir: tasksDir,
          filePath,
        });
      }
      removed.push(file);
    }
  }

  return { removed };
}
