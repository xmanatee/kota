import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { getRepoWorktreeStatusAsync } from "#core/util/repo-worktree.js";
import type { RepairCheckResult } from "./repair-loop-checks.js";

const execFileAsync = promisify(execFile);

export type RepairProgressSnapshot = {
  key: string;
  failureIds: string[];
};

async function gitDiffAgainstHead(workspaceDir: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["diff", "--binary", "HEAD", "--"],
      {
      cwd: workspaceDir,
      env: withProtectedGitBareRepositoryEnv(),
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      },
    );
    return stdout;
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

export async function repairProgressSnapshot(
  workspaceDir: string,
  failures: RepairCheckResult[],
): Promise<RepairProgressSnapshot> {
  const status = await getRepoWorktreeStatusAsync(workspaceDir);
  const diff = status.available ? await gitDiffAgainstHead(workspaceDir) : "";
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

export async function stageWorkflowChangesForRepairChecks(
  workspaceDir: string,
): Promise<void> {
  if (!(await getRepoWorktreeStatusAsync(workspaceDir)).available) return;
  await execFileAsync("git", ["add", "-A"], {
    cwd: workspaceDir,
    env: withProtectedGitBareRepositoryEnv(),
  });
}
