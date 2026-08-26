/**
 * Commit-diff helper for the agent-step recorder.
 *
 * The recorder resolves a source run's published range from runtime-owned
 * writer integration evidence, then walks that diff here: one `write`/`delete` per touched
 * repo-tree path, with renames expanded to a delete + write pair. Run-dir
 * paths (under `.kota/runs/<sourceRunId>/`) are filtered out and left to
 * the recorder's Write-event scan.
 */

import { spawnSync } from "node:child_process";
import { join, relative, resolve } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { readWriterIntegrationEvidence } from "#core/workflow/writer-integration-evidence.js";
import type { AgentStepFileOperation } from "./agent-step-recording.js";

type CommitDiffEntry =
  | { kind: "add"; path: string }
  | { kind: "modify"; path: string }
  | { kind: "delete"; path: string }
  | { kind: "rename"; oldPath: string; newPath: string };

function runGit(projectDir: string, args: readonly string[]): string {
  const result = spawnSync("git", args, {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${projectDir}: ${result.stderr.trim()}`,
    );
  }
  return result.stdout;
}

const SHA_PATTERN = /^[0-9a-f]{7,64}$/;

export function resolveSourceIntegrationRange(
  projectDir: string,
  sourceRunId: string,
): { baseHead: string; publishedHead: string } {
  const evidence = readWriterIntegrationEvidence(
    join(projectDir, ".kota", "runs"),
    sourceRunId,
  );
  if (evidence === null) {
    throw new Error(
      `Source run ${JSON.stringify(sourceRunId)} has no writer-integration.json; the recorder needs a successfully integrated writer run to extract repo-tree file operations.`,
    );
  }
  if (
    !SHA_PATTERN.test(evidence.integratedFromHead) ||
    !SHA_PATTERN.test(evidence.publishedHead)
  ) {
    throw new Error(
      `Writer integration evidence for source run ${JSON.stringify(sourceRunId)} has an invalid Git range.`,
    );
  }
  if (evidence.integratedFromHead === evidence.publishedHead) {
    throw new Error(
      `Source run ${JSON.stringify(sourceRunId)} integrated no repository changes; the recorder refuses to emit a partial recording.`,
    );
  }
  return {
    baseHead: evidence.integratedFromHead,
    publishedHead: evidence.publishedHead,
  };
}

// Parses `git diff --find-renames -z --name-status A B`. `-z` uses NUL
// separators: each record is a status token followed by one path (two
// paths for R/C entries).
function listCommitChanges(
  projectDir: string,
  baseHead: string,
  publishedHead: string,
): CommitDiffEntry[] {
  const stdout = runGit(projectDir, [
    "diff",
    "--find-renames",
    "-z",
    "--name-status",
    baseHead,
    publishedHead,
  ]);
  const tokens = stdout.split("\0");
  const entries: CommitDiffEntry[] = [];
  let i = 0;
  while (i < tokens.length) {
    const status = tokens[i];
    if (!status) {
      i++;
      continue;
    }
    const code = status.charAt(0);
    if (code === "R" || code === "C") {
      const oldPath = tokens[i + 1];
      const newPath = tokens[i + 2];
      if (oldPath === undefined || newPath === undefined) {
        throw new Error(
          `git diff --name-status malformed near rename token ${JSON.stringify(status)} for ${baseHead}..${publishedHead}.`,
        );
      }
      entries.push({ kind: "rename", oldPath, newPath });
      i += 3;
      continue;
    }
    const path = tokens[i + 1];
    if (path === undefined) {
      throw new Error(
        `git diff --name-status malformed near status token ${JSON.stringify(status)} for ${baseHead}..${publishedHead}.`,
      );
    }
    if (code === "A") entries.push({ kind: "add", path });
    else if (code === "M" || code === "T") entries.push({ kind: "modify", path });
    else if (code === "D") entries.push({ kind: "delete", path });
    else {
      throw new Error(
        `git diff --name-status unsupported status ${JSON.stringify(status)} for ${baseHead}..${publishedHead} at ${JSON.stringify(path)}.`,
      );
    }
    i += 2;
  }
  return entries;
}

function isInsideProject(projectDir: string, path: string): boolean {
  return !relative(projectDir, resolve(projectDir, path)).startsWith("..");
}

function isRunDirPath(path: string, sourceRunDir: string): boolean {
  return path === sourceRunDir || path.startsWith(`${sourceRunDir}/`);
}

export function extractCommitDiffOperations(
  projectDir: string,
  sourceRunId: string,
  baseHead: string,
  publishedHead: string,
): { ops: AgentStepFileOperation[]; skippedOutsideProject: string[] } {
  const sourceRunDir = join(".kota", "runs", sourceRunId);
  const ops: AgentStepFileOperation[] = [];
  const skippedOutsideProject: string[] = [];
  const readAt = (path: string): string =>
    runGit(projectDir, ["show", `${publishedHead}:${path}`]);
  for (const entry of listCommitChanges(projectDir, baseHead, publishedHead)) {
    if (entry.kind === "rename") {
      if (isRunDirPath(entry.oldPath, sourceRunDir) || isRunDirPath(entry.newPath, sourceRunDir)) continue;
      if (!isInsideProject(projectDir, entry.oldPath) || !isInsideProject(projectDir, entry.newPath)) {
        skippedOutsideProject.push(entry.oldPath, entry.newPath);
        continue;
      }
      ops.push({ op: "delete", path: entry.oldPath });
      ops.push({ op: "write", path: entry.newPath, content: readAt(entry.newPath) });
      continue;
    }
    if (isRunDirPath(entry.path, sourceRunDir)) continue;
    if (!isInsideProject(projectDir, entry.path)) {
      skippedOutsideProject.push(entry.path);
      continue;
    }
    if (entry.kind === "delete") ops.push({ op: "delete", path: entry.path });
    else ops.push({ op: "write", path: entry.path, content: readAt(entry.path) });
  }
  return { ops, skippedOutsideProject };
}
