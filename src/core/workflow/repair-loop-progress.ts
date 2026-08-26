import { createHash } from "node:crypto";
import type { RepairCheckResult } from "./repair-loop-checks.js";
import type { WorkflowCommandRunner } from "./workflow-command.js";
import { workflowCommandOutput } from "./workflow-command.js";

export type RepairProgressSnapshot = {
  key: string;
  failureIds: string[];
};

async function readGit(
  runCommand: WorkflowCommandRunner,
  workspaceDir: string,
  args: readonly string[],
): Promise<string> {
  try {
    const result = await runCommand({
      command: "git",
      args,
      cwd: workspaceDir,
      timeoutMs: 30_000,
      outputLimitBytes: 20 * 1024 * 1024,
      captureLimitBytesPerStream: 20 * 1024 * 1024,
    });
    return workflowCommandOutput(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `git ${args[0] ?? "command"} unavailable: ${message}`;
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
  runCommand: WorkflowCommandRunner,
): Promise<RepairProgressSnapshot> {
  const [head, status, diff] = await Promise.all([
    readGit(runCommand, workspaceDir, ["rev-parse", "HEAD"]),
    readGit(runCommand, workspaceDir, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]),
    readGit(runCommand, workspaceDir, ["diff", "--binary", "HEAD", "--"]),
  ]);
  const hash = createHash("sha256");
  hash.update(repairFailureIdentity(failures));
  hash.update("\0");
  hash.update(head);
  hash.update("\0");
  hash.update(status);
  hash.update("\0");
  hash.update(diff);
  return {
    key: hash.digest("hex"),
    failureIds: failures.map((failure) => failure.id),
  };
}
