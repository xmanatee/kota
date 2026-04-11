import { execSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type CommitResult = {
  committed: boolean;
  message?: string;
};

const DEFAULT_COMMIT_MESSAGE = "Workflow: update repo";

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
 * Reads the commit message from `<runDirPath>/commit-message.txt` if present,
 * otherwise falls back to a default message.
 * Returns `{ committed: false }` when there is nothing to commit.
 */
export function commitWorkflowChanges(
  projectDir: string,
  runDirPath: string,
): CommitResult {
  execSync("git add -A", { cwd: projectDir, stdio: "pipe" });
  const stagedFiles = runGit(projectDir, "git diff --cached --name-only");

  if (!stagedFiles) {
    return { committed: false };
  }

  const msgPath = join(runDirPath, "commit-message.txt");
  if (!existsSync(msgPath)) {
    writeFileSync(msgPath, DEFAULT_COMMIT_MESSAGE);
  }

  try {
    runGit(projectDir, `git commit -F ${JSON.stringify(msgPath)}`);
  } catch (error) {
    unstageAfterFailedCommit(projectDir, error);
    throw error;
  }

  const message = runGit(projectDir, "git log --format=%s -1");

  return { committed: true, message };
}
