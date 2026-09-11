import { createHash } from "node:crypto";
import type { RepairCheckResult } from "./repair-loop-checks.js";
import {
  WorkflowCommandError,
  type WorkflowCommandRunner,
  workflowCommandOutput,
} from "./workflow-command.js";

export type RepairProgressSnapshot = {
  key: string;
  failureIds: string[];
  changedPaths: string[];
  diffStat: string;
  diff: string;
};

const CONTINUATION_DIFF_LIMIT = 24_000;

function compact(value: string, limit = CONTINUATION_DIFF_LIMIT): string {
  if (value.length <= limit) return value;
  const retained = limit - 80;
  const head = Math.ceil(retained / 2);
  const tail = retained - head;
  return `${value.slice(0, head)}\n[... continuation evidence truncated ...]\n${value.slice(-tail)}`;
}

type PorcelainEntry = Readonly<{
  code: string;
  path: string;
}>;

function parsePorcelainStatus(status: string): PorcelainEntry[] {
  const records = status.split("\0");
  const entries: PorcelainEntry[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4) continue;
    const code = record.slice(0, 2);
    entries.push({ code, path: record.slice(3) });
    if (code.includes("R") || code.includes("C")) index += 1;
  }
  return entries;
}

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

async function readGitAllowingDiff(
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
    if (error instanceof WorkflowCommandError && error.exitCode === 1) {
      return [error.stdout.text, error.stderr.text]
        .filter((output) => output.length > 0)
        .join("\n");
    }
    const message = error instanceof Error ? error.message : String(error);
    return `git ${args[0] ?? "command"} unavailable: ${message}`;
  }
}

async function untrackedEvidence(
  runCommand: WorkflowCommandRunner,
  workspaceDir: string,
  paths: readonly string[],
): Promise<Readonly<{ manifest: string; diff: string; diffStat: string }>> {
  const manifest: string[] = [];
  const diffs: string[] = [];
  const stats: string[] = [];
  for (const path of paths) {
    const [blob, diff, diffStat] = await Promise.all([
      readGit(runCommand, workspaceDir, [
        "hash-object",
        "--no-filters",
        "--",
        path,
      ]),
      readGitAllowingDiff(runCommand, workspaceDir, [
        "diff",
        "--no-index",
        "--binary",
        "--",
        "/dev/null",
        path,
      ]),
      readGitAllowingDiff(runCommand, workspaceDir, [
        "diff",
        "--no-index",
        "--stat",
        "--",
        "/dev/null",
        path,
      ]),
    ]);
    manifest.push(`${path}\0${blob.trim()}\0`);
    if (diff.length > 0) diffs.push(diff);
    if (diffStat.length > 0) stats.push(diffStat);
  }
  return {
    manifest: manifest.join(""),
    diff: diffs.join("\n"),
    diffStat: stats.join("\n"),
  };
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
  const [head, status, trackedDiff, trackedDiffStat] = await Promise.all([
    readGit(runCommand, workspaceDir, ["rev-parse", "HEAD"]),
    readGit(runCommand, workspaceDir, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]),
    readGit(runCommand, workspaceDir, ["diff", "--binary", "HEAD", "--"]),
    readGit(runCommand, workspaceDir, ["diff", "--stat", "HEAD", "--"]),
  ]);
  const entries = parsePorcelainStatus(status);
  const paths = entries
    .map((entry) => entry.path)
    .sort((left, right) => left.localeCompare(right));
  const untracked = await untrackedEvidence(
    runCommand,
    workspaceDir,
    entries
      .filter((entry) => entry.code === "??")
      .map((entry) => entry.path)
      .sort((left, right) => left.localeCompare(right)),
  );
  const diff = [trackedDiff, untracked.diff].filter(Boolean).join("\n");
  const diffStat = [trackedDiffStat, untracked.diffStat]
    .filter(Boolean)
    .join("\n");
  const hash = createHash("sha256");
  hash.update(repairFailureIdentity(failures));
  hash.update("\0");
  hash.update(head);
  hash.update("\0");
  hash.update(status);
  hash.update("\0");
  hash.update(diff);
  hash.update("\0");
  hash.update(untracked.manifest);
  return {
    key: hash.digest("hex"),
    failureIds: failures.map((failure) => failure.id),
    changedPaths: paths,
    diffStat: compact(diffStat, 8_000),
    diff: compact(diff),
  };
}
