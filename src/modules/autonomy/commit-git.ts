import { execFileSync } from "node:child_process";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";

const GIT_INDEX_LOCK_RETRY_DELAYS_MS = [100, 250, 500, 1_000, 2_000, 3_000];

export function isGitIndexLockErrorMessage(message: string): boolean {
  return message.includes("index.lock");
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function withGitIndexLockRetry<T>(run: () => T): T {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const delayMs = GIT_INDEX_LOCK_RETRY_DELAYS_MS[attempt];
      if (!isGitIndexLockErrorMessage(message) || delayMs === undefined) {
        throw error;
      }
      sleepSync(delayMs);
    }
  }
}

/**
 * Returns paths already staged as deletions. They are absent from both the
 * working tree and index, so a later path-limited `git add -A` cannot re-add
 * them and should leave their staged state intact.
 */
export function listStagedDeletions(projectDir: string): Set<string> {
  const stdout = execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "--no-renames", "--diff-filter=D"],
    {
      cwd: projectDir,
      env: withProtectedGitBareRepositoryEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const paths = new Set<string>();
  for (const line of stdout.split("\n")) {
    const path = line.trim();
    if (path.length > 0) paths.add(path);
  }
  return paths;
}

export function listPathsNeedingStaging(
  projectDir: string,
  paths: readonly string[],
): string[] {
  if (paths.length === 0) return [];
  const stdout = execFileSync(
    "git",
    [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--ignored=matching",
      "--",
      ...paths,
    ],
    {
      cwd: projectDir,
      env: withProtectedGitBareRepositoryEnv(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const entries = stdout.split("\0").filter((entry) => entry.length > 0);
  const needsStaging: string[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index] ?? "";
    if (entry.length < 4) continue;
    const indexStatus = entry[0];
    const worktreeStatus = entry[1];
    const path = entry.slice(3);
    if (indexStatus === "R" || indexStatus === "C") index += 1;
    if (
      (indexStatus === "?" && worktreeStatus === "?") ||
      (indexStatus === "!" && worktreeStatus === "!") ||
      worktreeStatus !== " "
    ) {
      needsStaging.push(path);
    }
  }
  return [...new Set(needsStaging)];
}

export function stageWorkflowPaths(
  projectDir: string,
  paths: readonly string[],
  options: { includeIgnored?: boolean } = {},
): void {
  if (paths.length === 0) return;
  withGitIndexLockRetry(() => {
    execFileSync(
      "git",
      [
        "add",
        ...(options.includeIgnored === true ? ["--force"] : []),
        "-A",
        "--",
        ...paths,
      ],
      {
        cwd: projectDir,
        env: withProtectedGitBareRepositoryEnv(),
        stdio: "pipe",
      },
    );
  });
}
