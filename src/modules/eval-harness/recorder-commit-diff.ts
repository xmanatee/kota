/**
 * Commit-diff helper for the agent-step recorder.
 *
 * The recorder resolves a source run's commit SHA from `steps/commit.json`,
 * then walks that commit's diff here: one `write`/`delete` per touched
 * repo-tree path, with renames expanded to a delete + write pair. Run-dir
 * paths (under `.kota/runs/<sourceRunId>/`) are filtered out and left to
 * the recorder's Write-event scan.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { AgentStepFileOperation } from "./agent-step-recording.js";

type CommitDiffEntry =
  | { kind: "add"; path: string }
  | { kind: "modify"; path: string }
  | { kind: "delete"; path: string }
  | { kind: "rename"; oldPath: string; newPath: string };

function runGit(projectDir: string, args: readonly string[]): string {
  const result = spawnSync("git", args, {
    cwd: projectDir,
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

export function resolveSourceCommitSha(
  projectDir: string,
  sourceRunId: string,
  explicitSha?: string,
): string {
  const path = join(projectDir, ".kota", "runs", sourceRunId, "steps", "commit.json");
  if (!existsSync(path)) {
    throw new Error(
      `Source run ${JSON.stringify(sourceRunId)} has no steps/commit.json; the recorder needs a committing source run to extract repo-tree file operations.`,
    );
  }
  const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  const output = (raw as { output?: unknown } | null)?.output;
  if (!output || typeof output !== "object") {
    throw new Error(
      `Source commit artifact at ${path} has no "output" object; cannot determine commit SHA.`,
    );
  }
  const committed = (output as { committed?: unknown }).committed;
  if (committed !== true) {
    throw new Error(
      `Source run ${JSON.stringify(sourceRunId)} did not commit (steps/commit.json output.committed=${JSON.stringify(committed)}); the recorder refuses to emit a partial recording. Pick a source run whose commit step committed, or author the recording by hand for this run.`,
    );
  }
  if (explicitSha !== undefined) {
    if (!SHA_PATTERN.test(explicitSha)) {
      throw new Error(
        `Explicit commit SHA ${JSON.stringify(explicitSha)} is not a hex string of 7–64 chars.`,
      );
    }
    // Explicit-override path exists to record fixtures derived from source
    // runs that pre-date the commit-step's SHA capture (steps/commit.json
    // reports committed=true but carries no sha field). The override still
    // requires committed=true so we can never emit a recording for a run
    // that failed to commit. `git show <sha>:<path>` inside
    // extractCommitDiffOperations fails loudly if the sha does not resolve.
    return explicitSha;
  }
  const sha = (output as { sha?: unknown }).sha;
  if (typeof sha !== "string" || !SHA_PATTERN.test(sha)) {
    throw new Error(
      `Source commit artifact at ${path} reports committed=true but no valid "sha" field; upgrade the source run, reproduce it with a commit step that captures the SHA, or pass --source-commit-sha <sha> to the recorder.`,
    );
  }
  return sha;
}

// Parses `git diff --find-renames -z --name-status A B`. `-z` uses NUL
// separators: each record is a status token followed by one path (two
// paths for R/C entries).
function listCommitChanges(projectDir: string, sha: string): CommitDiffEntry[] {
  const stdout = runGit(projectDir, [
    "diff",
    "--find-renames",
    "-z",
    "--name-status",
    `${sha}^`,
    sha,
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
          `git diff --name-status malformed near rename token ${JSON.stringify(status)} for ${sha}.`,
        );
      }
      entries.push({ kind: "rename", oldPath, newPath });
      i += 3;
      continue;
    }
    const path = tokens[i + 1];
    if (path === undefined) {
      throw new Error(
        `git diff --name-status malformed near status token ${JSON.stringify(status)} for ${sha}.`,
      );
    }
    if (code === "A") entries.push({ kind: "add", path });
    else if (code === "M" || code === "T") entries.push({ kind: "modify", path });
    else if (code === "D") entries.push({ kind: "delete", path });
    else {
      throw new Error(
        `git diff --name-status unsupported status ${JSON.stringify(status)} for ${sha} at ${JSON.stringify(path)}.`,
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
  sha: string,
): { ops: AgentStepFileOperation[]; skippedOutsideProject: string[] } {
  const sourceRunDir = join(".kota", "runs", sourceRunId);
  const ops: AgentStepFileOperation[] = [];
  const skippedOutsideProject: string[] = [];
  const readAt = (path: string): string => runGit(projectDir, ["show", `${sha}:${path}`]);
  for (const entry of listCommitChanges(projectDir, sha)) {
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
