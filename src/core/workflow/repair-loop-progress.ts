import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import type { RepairCheckResult } from "./repair-loop-checks.js";

export type RepairProgressSnapshot = {
  key: string;
  failureIds: string[];
};

function gitDiffAgainstHead(workspaceDir: string): string {
  try {
    return execFileSync("git", ["diff", "--binary", "HEAD", "--"], {
      cwd: workspaceDir,
      env: withProtectedGitBareRepositoryEnv(),
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `git diff unavailable: ${message}`;
  }
}

function repairFailureIdentity(failures: RepairCheckResult[]): string {
  return failures
    .map((failure) => failure.id)
    .sort()
    .join("\0");
}

export function repairProgressSnapshot(
  workspaceDir: string,
  failures: RepairCheckResult[],
): RepairProgressSnapshot {
  const status = getRepoWorktreeStatus(workspaceDir);
  const diff = status.available ? gitDiffAgainstHead(workspaceDir) : "";
  const hash = createHash("sha256");
  hash.update(repairFailureIdentity(failures));
  hash.update("\0");
  hash.update(status.headSha);
  hash.update("\0");
  hash.update(status.fingerprint);
  hash.update("\0");
  hash.update(diff);
  return {
    key: hash.digest("hex"),
    failureIds: failures.map((failure) => failure.id),
  };
}

export function stageWorkflowChangesForRepairChecks(
  workspaceDir: string,
): void {
  if (!getRepoWorktreeStatus(workspaceDir).available) return;
  execFileSync("git", ["add", "-A"], {
    cwd: workspaceDir,
    env: withProtectedGitBareRepositoryEnv(),
    stdio: ["ignore", "ignore", "pipe"],
  });
}
