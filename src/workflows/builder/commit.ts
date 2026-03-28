import { execSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type CommitResult = {
  committed: boolean;
  message?: string;
};

const DEFAULT_COMMIT_MESSAGE = "Workflow: update repo";

/**
 * Commits any staged changes in the project directory.
 * Reads the commit message from `<runDirPath>/commit-message.txt` if present,
 * otherwise falls back to a default message.
 * Returns `{ committed: false }` when there are no staged changes.
 */
export function commitBuilderChanges(
  projectDir: string,
  runDirPath: string,
): CommitResult {
  const stagedFiles = execSync("git diff --cached --name-only", {
    cwd: projectDir,
    encoding: "utf-8",
  }).trim();

  if (!stagedFiles) {
    return { committed: false };
  }

  const msgPath = join(runDirPath, "commit-message.txt");
  if (!existsSync(msgPath)) {
    writeFileSync(msgPath, DEFAULT_COMMIT_MESSAGE);
  }

  execSync(`git commit -F ${JSON.stringify(msgPath)}`, {
    cwd: projectDir,
    encoding: "utf-8",
  });

  const message = execSync("git log --format=%s -1", {
    cwd: projectDir,
    encoding: "utf-8",
  }).trim();

  return { committed: true, message };
}
