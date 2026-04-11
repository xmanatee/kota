import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

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

/**
 * Stages all working tree changes and commits them.
 * Requires `<runDirPath>/commit-message.txt` when there is anything to commit.
 * Returns `{ committed: false }` when there is nothing to commit.
 */
export function commitWorkflowChanges(
  projectDir: string,
  runDirPath: string,
): CommitResult {
  const worktreeChanges = runGit(projectDir, "git status --porcelain=v1");

  if (!worktreeChanges) {
    return { committed: false };
  }

  const msgPath = join(runDirPath, "commit-message.txt");
  if (!existsSync(msgPath)) {
    throw new Error(`Missing required workflow commit message: ${msgPath}`);
  }
  if (readFileSync(msgPath, "utf8").trim().length === 0) {
    throw new Error(`Workflow commit message must not be empty: ${msgPath}`);
  }

  execSync("git add -A", { cwd: projectDir, stdio: "pipe" });

  try {
    runGit(projectDir, `git commit -F ${JSON.stringify(msgPath)}`);
  } catch (error) {
    unstageAfterFailedCommit(projectDir, error);
    throw error;
  }

  const message = runGit(projectDir, "git log --format=%s -1");

  return { committed: true, message };
}
