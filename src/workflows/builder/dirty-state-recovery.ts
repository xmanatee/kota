import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getRepoWorktreeStatus } from "../../repo-worktree.js";

/**
 * Detects a dirty worktree left by a previous failed builder run and resets
 * to the last commit, logging discarded paths before proceeding.
 *
 * Only fires when the worktree is dirty. If there are stranded doing tasks
 * (left by a timed-out or failed builder run), their content is saved and
 * they are re-created in ready/ after the git reset, so the next builder run
 * can re-attempt them.
 *
 * Does NOT modify assertRepoWorktreeClean or repo-worktree.ts.
 */
export function autoResetDirtyWorktree(
  projectDir: string,
  warn: (msg: string) => void,
): void {
  const status = getRepoWorktreeStatus(projectDir);
  if (!status.available || !status.dirty) return;

  const doingDir = join(projectDir, "tasks", "doing");
  const readyDir = join(projectDir, "tasks", "ready");

  // Save doing task contents before git clean removes them
  const doingTaskFiles = existsSync(doingDir)
    ? readdirSync(doingDir).filter((f) => f.endsWith(".md") && f !== "AGENTS.md")
    : [];
  const savedTasks = doingTaskFiles.map((file) => ({
    file,
    content: readFileSync(join(doingDir, file), "utf8"),
  }));

  warn(
    `[dirty-state-recovery] Dirty worktree detected from a previous failed run. Discarding:\n` +
      status.entries.map((e) => `  ${e}`).join("\n"),
  );

  execFileSync("git", ["reset", "--hard", "HEAD"], { cwd: projectDir, stdio: "ignore" });
  execFileSync("git", ["clean", "-fd"], { cwd: projectDir, stdio: "ignore" });

  // Recreate stranded doing tasks in ready/ so the next builder run re-attempts them
  if (savedTasks.length > 0) {
    mkdirSync(readyDir, { recursive: true });
    for (const { file, content } of savedTasks) {
      writeFileSync(join(readyDir, file), content, "utf8");
    }
    warn(
      `[dirty-state-recovery] Stranded doing tasks moved back to ready/: ${savedTasks.map((t) => t.file).join(", ")}`,
    );
  }
}
