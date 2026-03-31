import { execFileSync } from "node:child_process";
import { countRepoTasks } from "../../repo-tasks.js";
import { getRepoWorktreeStatus } from "../../repo-worktree.js";

/**
 * Detects a dirty worktree left by a previous failed builder run and resets
 * to the last commit, logging discarded paths before proceeding.
 *
 * Only fires when:
 * - The worktree is dirty (early-exit no-op when clean)
 * - No tasks are in doing/ (i.e., no active builder work)
 *
 * Does NOT modify assertRepoWorktreeClean or repo-worktree.ts.
 */
export function autoResetDirtyWorktree(
  projectDir: string,
  warn: (msg: string) => void,
): void {
  const status = getRepoWorktreeStatus(projectDir);
  if (!status.available || !status.dirty) return;

  const doingCount = countRepoTasks(projectDir, "doing");
  if (doingCount > 0) return;

  warn(
    `[dirty-state-recovery] Dirty worktree detected with no active doing tasks. Discarding:\n` +
      status.entries.map((e) => `  ${e}`).join("\n"),
  );

  execFileSync("git", ["reset", "--hard", "HEAD"], { cwd: projectDir, stdio: "ignore" });
  execFileSync("git", ["clean", "-fd"], { cwd: projectDir, stdio: "ignore" });
}
