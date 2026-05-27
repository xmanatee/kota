import { spawnSync } from "node:child_process";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import { labeledPredicate, type WorkflowPredicate } from "#core/workflow/run-types.js";

export type RecoveryResetResult = {
  stashed: boolean;
  stashSummary: string;
  branchRestored: boolean;
  previousBranch: string | null;
  currentBranch: string;
};

export type RecoveryResetOptions = {
  projectDir: string;
  workflowName: string;
  /**
   * When true, a `kota/task/*` branch is switched back to the repo's base
   * branch before completing. Only builder uses branch-per-task today.
   */
  restoreBaseBranch?: boolean;
  /**
   * Base branch to return to when the repo is currently on a `kota/task/*`
   * branch. Defaults to "main".
   */
  baseBranch?: string;
};

function getCurrentBranch(projectDir: string): string {
  const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.stdout.trim() || "main";
}

/**
 * Reset the worktree to a safe base before a recovery-capable workflow runs.
 *
 * Stashes any tracked dirt (idempotent: no-op when already clean) and
 * optionally switches back to the base branch when the workflow is on a
 * per-task branch. Designed to be called as the first substantive step when
 * `trigger.event === "runtime.recovered"`.
 *
 * Side effects are strictly local (git stash, git checkout). No network calls
 * happen before the reset completes — the recovery contract requires this so
 * the reset is safe to retry.
 */
export function resetWorktreeForRecovery(
  options: RecoveryResetOptions,
): RecoveryResetResult {
  const { projectDir, workflowName, restoreBaseBranch = false, baseBranch = "main" } = options;

  const status = getRepoWorktreeStatus(projectDir);

  let stashed = false;
  let stashSummary = "worktree clean (no tracked changes)";
  if (status.available && status.trackedDirty) {
    const result = spawnSync(
      "git",
      ["stash", "push", "--include-untracked", "-m", `Recovery: ${workflowName} auto-stash`],
      {
        cwd: projectDir,
        env: withProtectedGitBareRepositoryEnv(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    if (result.status !== 0) {
      throw new Error(`git stash failed for ${workflowName}: ${result.stderr}`);
    }
    stashed = true;
    stashSummary = result.stdout.trim() || "stashed tracked changes";
  }

  const currentBranch = getCurrentBranch(projectDir);
  let branchRestored = false;
  let previousBranch: string | null = null;
  if (restoreBaseBranch && currentBranch.startsWith("kota/task/") && currentBranch !== baseBranch) {
    const checkout = spawnSync("git", ["checkout", baseBranch], {
      cwd: projectDir,
      env: withProtectedGitBareRepositoryEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (checkout.status !== 0) {
      throw new Error(
        `git checkout ${baseBranch} failed during ${workflowName} recovery: ${checkout.stderr || checkout.stdout}`,
      );
    }
    branchRestored = true;
    previousBranch = currentBranch;
  }

  return {
    stashed,
    stashSummary,
    branchRestored,
    previousBranch,
    currentBranch: branchRestored ? baseBranch : currentBranch,
  };
}

/**
 * Predicate selecting steps that should run only on the recovery entry path.
 */
export const onRecoveryTrigger: WorkflowPredicate = labeledPredicate(
  "recovery-only-step",
  ({ trigger }) => trigger.event === "runtime.recovered",
);

/**
 * Predicate selecting steps that should run only on non-recovery entries.
 * Recovery-capable workflows use this to gate their normal work steps so the
 * workflow healed the worktree but did not execute heavy work.
 */
export const onNormalTrigger: WorkflowPredicate = labeledPredicate(
  "recovery-trigger-gate",
  ({ trigger }) => trigger.event !== "runtime.recovered",
);
