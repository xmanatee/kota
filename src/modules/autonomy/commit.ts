import { execFileSync, execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import {
  diffMutatedPaths,
  listWorkflowMutatedPaths,
} from "#core/workflow/steps/agent-write-scope.js";
import {
  isGitIndexLockErrorMessage,
  listPathsNeedingStaging,
  listStagedDeletions,
  listStagedPaths,
  stageWorkflowPaths,
  withGitIndexLockRetry,
} from "./commit-git.js";
import {
  checkNoRegisteredScratchWorktrees,
  findScratchArtifactPaths,
} from "./shared.js";

export type CommitResult =
  | { committed: false }
  | { committed: true; message: string; sha: string };

export type WorkflowCommitPathPolicy =
  | { kind: "all-mutated-paths" }
  | {
    kind: "paths-mutated-since-baseline";
    baselineMutatedPaths: readonly string[];
  }
  | {
    kind: "all-mutated-paths-with-boundaries";
    excludedPathRoots: readonly string[];
    allowedPaths: readonly string[];
  };

const ALL_MUTATED_PATHS: WorkflowCommitPathPolicy = { kind: "all-mutated-paths" };

function runGit(projectDir: string, command: string): string {
  return execSync(command, {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
}

function runGitCommitOnlyPaths(
  projectDir: string,
  msgPath: string,
  paths: readonly string[],
): void {
  withGitIndexLockRetry(() => {
    execFileSync("git", ["commit", "-F", msgPath, "--only", "--", ...paths], {
      cwd: projectDir,
      env: withProtectedGitBareRepositoryEnv(),
      stdio: "pipe",
    });
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unstageAfterFailedCommit(projectDir: string, commitError: unknown): void {
  try {
    execSync("git reset --mixed HEAD", {
      cwd: projectDir,
      env: withProtectedGitBareRepositoryEnv(),
      stdio: "pipe",
    });
  } catch (resetError) {
    throw new Error(
      `git commit failed, then git reset --mixed HEAD failed: ${describeError(commitError)}`,
      { cause: resetError },
    );
  }
}

function checkNoScratchArtifactsInPaths(paths: readonly string[]): void {
  const violations = findScratchArtifactPaths([...paths]);
  if (violations.length > 0) {
    throw new Error(
      `Scratch artifacts must not be committed:\n${violations.map((v) => `  ${v}`).join("\n")}`,
    );
  }
}

function listCommitMutatedPaths(
  projectDir: string,
  policy: WorkflowCommitPathPolicy,
): string[] {
  const mutatedPaths = listWorkflowMutatedPaths(projectDir);
  if (policy.kind === "all-mutated-paths") return mutatedPaths;
  if (policy.kind === "paths-mutated-since-baseline") {
    return diffMutatedPaths(policy.baselineMutatedPaths, mutatedPaths);
  }

  const allowedPaths = new Set(policy.allowedPaths);
  return mutatedPaths.filter(
    (path) =>
      allowedPaths.has(path) ||
      !policy.excludedPathRoots.some(
        (root) => path === root || path.startsWith(`${root}/`),
      ),
  );
}

export function listStagedPathsExcludedFromCommit(
  projectDir: string,
  policy: WorkflowCommitPathPolicy,
): string[] {
  const includedPaths = new Set(listCommitMutatedPaths(projectDir, policy));
  return listStagedPaths(projectDir).filter((path) => !includedPaths.has(path));
}

/**
 * Returns the exact set of paths `commitWorkflowChanges` would pass to
 * `git add -A -- <paths>`: the workflow-owned mutations minus any paths
 * already staged as deletions (which `git add -A` cannot re-stage).
 * Exported so repair-loop checks can simulate the same staging call the
 * terminal commit step will make.
 */
export function listCommitStagePaths(
  projectDir: string,
  policy: WorkflowCommitPathPolicy = ALL_MUTATED_PATHS,
): string[] {
  const mutatedPaths = listCommitMutatedPaths(projectDir, policy);
  if (mutatedPaths.length === 0) return [];
  const alreadyStagedDeletions = listStagedDeletions(projectDir);
  return mutatedPaths.filter((p) => !alreadyStagedDeletions.has(p));
}

/**
 * Repair-loop check: fails if `git add -A -- <paths>` would refuse to
 * stage any of the mutated paths. The commit step's staging call is
 * terminal, so an ignore conflict (e.g. a nested `.gitignore` re-ignoring
 * what the repo-root rules un-ignored) wastes the whole agent run. This
 * dry-runs the exact call so the agent can repair it before commit.
 */
export function checkCommitStageable(
  projectDir: string,
  policy: WorkflowCommitPathPolicy = ALL_MUTATED_PATHS,
): string {
  const pathsToStage = listCommitStagePaths(projectDir, policy);
  if (pathsToStage.length === 0) return "OK: no mutated paths to stage";
  const pathsNeedingStaging = listPathsNeedingStaging(projectDir, pathsToStage);
  if (pathsNeedingStaging.length === 0) {
    return `OK: ${pathsToStage.length} mutated path(s) already staged`;
  }
  let result: ReturnType<typeof spawnSync>;
  try {
    result = withGitIndexLockRetry(() => {
      const dryRun = spawnSync(
        "git",
        ["add", "--dry-run", "-A", "--", ...pathsNeedingStaging],
        {
          cwd: projectDir,
          env: withProtectedGitBareRepositoryEnv(),
          encoding: "utf8",
        },
      );
      if (dryRun.status !== 0) {
        const detail = [dryRun.stdout, dryRun.stderr]
          .filter((s) => s && s.length > 0)
          .join("\n")
          .trim();
        if (isGitIndexLockErrorMessage(detail)) {
          throw new Error(detail);
        }
      }
      return dryRun;
    });
  } catch (error) {
    const message = describeError(error);
    if (isGitIndexLockErrorMessage(message)) {
      throw new Error(
        `git index lock blocked staging after retries:\n${message}\n\n` +
          "Remove the stale Git index lock or wait for the other Git process " +
          "to finish, then rerun validation.",
        { cause: error },
      );
    }
    throw error;
  }
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr]
      .filter((s) => s && s.length > 0)
      .join("\n")
      .trim();
    throw new Error(
      `git would refuse to stage the commit set:\n${detail}\n\n` +
        "Resolve the conflict before finishing: either edit or remove the " +
        "gitignore rule (often a nested .gitignore) that rejects the listed " +
        "path, or delete the file from the working tree if it should not be " +
        "committed.",
    );
  }
  return `OK: ${pathsNeedingStaging.length} mutated path(s) stageable`;
}

/**
 * Stages and commits exactly the set of paths `listWorkflowMutatedPaths`
 * identifies as workflow-owned mutations. The commit itself is path-limited,
 * so unrelated index entries left by an earlier workflow cannot ride along.
 * That matches the path set the writeScope gate evaluated earlier in the run,
 * so an untracked file the gate rejected cannot reappear at staging time.
 *
 * Requires `<runDirPath>/commit-message.txt` when there is anything to commit.
 * Returns `{ committed: false }` when the mutated path set is empty.
 */
export function commitWorkflowChanges(
  projectDir: string,
  runDirPath: string,
  policy: WorkflowCommitPathPolicy = ALL_MUTATED_PATHS,
): CommitResult {
  checkNoRegisteredScratchWorktrees(projectDir);
  const mutatedPaths = listCommitMutatedPaths(projectDir, policy);

  if (mutatedPaths.length === 0) {
    return { committed: false };
  }
  checkNoScratchArtifactsInPaths(mutatedPaths);

  const msgPath = join(runDirPath, "commit-message.txt");
  if (!existsSync(msgPath)) {
    throw new Error(`Missing required workflow commit message: ${msgPath}`);
  }
  if (readFileSync(msgPath, "utf8").trim().length === 0) {
    throw new Error(`Workflow commit message must not be empty: ${msgPath}`);
  }

  const alreadyStagedDeletions = listStagedDeletions(projectDir);
  const pathsToStage = mutatedPaths.filter((p) => !alreadyStagedDeletions.has(p));
  const pathsNeedingStaging = listPathsNeedingStaging(projectDir, pathsToStage);

  if (pathsNeedingStaging.length > 0) {
    stageWorkflowPaths(projectDir, pathsNeedingStaging);
  }

  try {
    runGitCommitOnlyPaths(projectDir, msgPath, mutatedPaths);
  } catch (error) {
    if (isGitIndexLockErrorMessage(describeError(error))) {
      throw error;
    }
    unstageAfterFailedCommit(projectDir, error);
    throw error;
  }

  const message = runGit(projectDir, "git log --format=%s -1");
  const sha = runGit(projectDir, "git rev-parse HEAD");

  return { committed: true, message, sha };
}
