import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listWorkflowMutatedPaths } from "#core/workflow/steps/agent-write-scope.js";
import {
  checkNoRegisteredScratchWorktrees,
  findScratchArtifactPaths,
} from "./shared.js";

export type CommitResult =
  | { committed: false }
  | { committed: true; message: string };

function runGit(projectDir: string, command: string): string {
  return execSync(command, {
    cwd: projectDir,
    encoding: "utf-8",
    stdio: "pipe",
  }).trim();
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unstageAfterFailedCommit(projectDir: string, commitError: unknown): void {
  try {
    execSync("git reset --mixed HEAD", { cwd: projectDir, stdio: "pipe" });
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

  execFileSync("git", ["add", "-A", "--", ...mutatedPaths], {
    cwd: projectDir,
    stdio: "pipe",
  });

  try {
    runGit(projectDir, `git commit -F ${JSON.stringify(msgPath)}`);
  } catch (error) {
    unstageAfterFailedCommit(projectDir, error);
    throw error;
  }

  const message = runGit(projectDir, "git log --format=%s -1");

  return { committed: true, message };
}
