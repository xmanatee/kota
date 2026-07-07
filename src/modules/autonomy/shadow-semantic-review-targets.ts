import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { listWorkflowMutatedPaths } from "#core/workflow/steps/agent-write-scope.js";
import { getChangedFiles, getStagedDiff, getStagedDiffContent } from "./critic-diff.js";
import type { ShadowSemanticReviewArtifactRef } from "./shadow-semantic-review-types.js";

const GIT_MAX_BUFFER = 5 * 1024 * 1024;
const GIT_DIFF_MAX_BUFFER = 50 * 1024 * 1024;
const DIFF_CHAR_LIMIT = 80_000;

export function stagedDiffArtifacts(projectDir: string): ShadowSemanticReviewArtifactRef[] {
  try {
    return [
      { path: "git:staged-diff-files", content: getChangedFiles(projectDir) },
      { path: "git:staged-diff-stat", content: getStagedDiff(projectDir) },
      { path: "git:staged-diff", content: getStagedDiffContent(projectDir) },
    ];
  } catch (error) {
    return [
      {
        path: "git:staged-diff-error",
        content: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}

function runGitWithTemporaryIndex(args: {
  projectDir: string;
  indexPath: string;
  gitArgs: readonly string[];
  maxBuffer?: number;
}): string {
  return execFileSync("git", [...args.gitArgs], {
    cwd: args.projectDir,
    env: {
      ...withProtectedGitBareRepositoryEnv(),
      GIT_INDEX_FILE: args.indexPath,
    },
    encoding: "utf8",
    maxBuffer: args.maxBuffer ?? GIT_MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function readTemporaryCommitDiff(projectDir: string, gitArgs: readonly string[]): string {
  const mutatedPaths = listWorkflowMutatedPaths(projectDir);
  if (mutatedPaths.length === 0) return "";

  const tempDir = mkdtempSync(join(tmpdir(), "kota-shadow-review-index-"));
  const indexPath = join(tempDir, "index");
  try {
    runGitWithTemporaryIndex({
      projectDir,
      indexPath,
      gitArgs: ["read-tree", "HEAD"],
    });
    runGitWithTemporaryIndex({
      projectDir,
      indexPath,
      gitArgs: ["add", "-A", "--", ...mutatedPaths],
    });
    return runGitWithTemporaryIndex({
      projectDir,
      indexPath,
      gitArgs,
      maxBuffer: GIT_DIFF_MAX_BUFFER,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function getWorkflowMutationFiles(projectDir: string): string {
  return listWorkflowMutatedPaths(projectDir).join("\n");
}

function getWorkflowMutationDiffStat(projectDir: string): string {
  return readTemporaryCommitDiff(projectDir, ["diff", "--cached", "--stat"]);
}

function getWorkflowMutationDiffContent(projectDir: string): string {
  let diff: string;
  try {
    diff = readTemporaryCommitDiff(projectDir, ["diff", "--cached"]);
  } catch {
    return "[Workflow mutation diff too large to capture — review via changed files and stat only]";
  }
  if (diff.length > DIFF_CHAR_LIMIT) {
    return `${diff.slice(0, DIFF_CHAR_LIMIT)}\n\n[... diff truncated at ${DIFF_CHAR_LIMIT / 1000}k chars ...]`;
  }
  return diff;
}

export function workflowMutationArtifacts(
  projectDir: string,
): ShadowSemanticReviewArtifactRef[] {
  try {
    return [
      { path: "git:workflow-mutation-files", content: getWorkflowMutationFiles(projectDir) },
      {
        path: "git:workflow-mutation-diff-stat",
        content: getWorkflowMutationDiffStat(projectDir),
      },
      {
        path: "git:workflow-mutation-diff",
        content: getWorkflowMutationDiffContent(projectDir),
      },
    ];
  } catch (error) {
    return [
      {
        path: "git:workflow-mutation-diff-error",
        content: error instanceof Error ? error.message : String(error),
      },
    ];
  }
}
