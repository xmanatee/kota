import { execFileSync, execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { listWorkflowMutatedPaths } from "#core/workflow/steps/agent-write-scope.js";
import {
  checkNoRegisteredScratchWorktrees,
  findScratchArtifactPaths,
} from "./shared.js";

export type CommitResult =
  | { committed: false }
  | { committed: true; message: string; sha: string };

function runGit(projectDir: string, command: string): string {
  return execSync(command, {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
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

/**
 * Returns paths already staged as deletions (present in HEAD, absent from
 * the index — the state `git rm <path>` leaves behind). Such paths appear in
 * `git diff --name-only HEAD` but `git add -A -- <path>` rejects them with
 * "pathspec did not match any files" because neither working tree nor index
 * has an entry to match. They are already correctly staged, so the commit
 * step does not need to re-add them.
 */
function listStagedDeletions(projectDir: string): Set<string> {
  const stdout = execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=D"],
    {
      cwd: projectDir,
      env: withProtectedGitBareRepositoryEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const set = new Set<string>();
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) set.add(trimmed);
  }
  return set;
}

/**
 * Returns the exact set of paths `commitWorkflowChanges` would pass to
 * `git add -A -- <paths>`: the workflow-owned mutations minus any paths
 * already staged as deletions (which `git add -A` cannot re-stage).
 * Exported so repair-loop checks can simulate the same staging call the
 * terminal commit step will make.
 */
export function listCommitStagePaths(projectDir: string): string[] {
  const mutatedPaths = listWorkflowMutatedPaths(projectDir);
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
export function checkCommitStageable(projectDir: string): string {
  const pathsToStage = listCommitStagePaths(projectDir);
  if (pathsToStage.length === 0) return "OK: no mutated paths to stage";
  const result = spawnSync(
    "git",
    ["add", "--dry-run", "-A", "--", ...pathsToStage],
    {
      cwd: projectDir,
      env: withProtectedGitBareRepositoryEnv(),
      encoding: "utf8",
    },
  );
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
  return `OK: ${pathsToStage.length} mutated path(s) stageable`;
}

/**
 * Stages and commits exactly the set of paths `listWorkflowMutatedPaths`
 * identifies as workflow-owned mutations. That matches the path set the
 * writeScope gate evaluated earlier in the run, so an untracked file the
 * gate rejected cannot reappear at staging time.
 *
 * Requires `<runDirPath>/commit-message.txt` when there is anything to commit.
 * Returns `{ committed: false }` when the mutated path set is empty.
 */
export function commitWorkflowChanges(
  projectDir: string,
  runDirPath: string,
): CommitResult {
  checkNoRegisteredScratchWorktrees(projectDir);
  const mutatedPaths = listWorkflowMutatedPaths(projectDir);

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

  if (pathsToStage.length > 0) {
    execFileSync("git", ["add", "-A", "--", ...pathsToStage], {
      cwd: projectDir,
      env: withProtectedGitBareRepositoryEnv(),
      stdio: "pipe",
    });
  }

  try {
    runGit(projectDir, `git commit -F ${JSON.stringify(msgPath)}`);
  } catch (error) {
    unstageAfterFailedCommit(projectDir, error);
    throw error;
  }

  const message = runGit(projectDir, "git log --format=%s -1");
  const sha = runGit(projectDir, "git rev-parse HEAD");

  return { committed: true, message, sha };
}
