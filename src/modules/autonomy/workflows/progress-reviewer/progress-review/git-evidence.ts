import { execFileSync } from "node:child_process";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import {
  PROGRESS_REVIEW_MAX_GIT_COMMITS,
  PROGRESS_REVIEW_MAX_GIT_ENTRIES,
  PROGRESS_REVIEW_MAX_GIT_FILES_PER_COMMIT,
  PROGRESS_REVIEW_MAX_GIT_STATUS_LINES,
} from "./constants.js";
import { sourceEvidenceId, sourceSummary } from "./trigger-target.js";
import type {
  ProgressReviewDirectorySource,
  ProgressReviewGitEvidence,
} from "./types.js";

function gitLines(projectDir: string, args: readonly string[]): string[] {
  const output = execFileSync("git", args, {
    cwd: projectDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return output.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

function hasGitHead(projectDir: string): boolean {
  try {
    gitLines(projectDir, ["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

function shortCommit(commit: string): string {
  return commit.slice(0, 12);
}

function commitTimestamp(unixSeconds: string): string | null {
  const seconds = Number.parseInt(unixSeconds, 10);
  if (!Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

function listGitStatusEvidence(
  source: ProgressReviewDirectorySource,
  excluded: string[],
): ProgressReviewGitEvidence[] {
  try {
    const status = gitLines(source.projectDir, ["status", "--short"]);
    if (status.length > PROGRESS_REVIEW_MAX_GIT_STATUS_LINES) {
      excluded.push(
        `${source.displayName} git status: truncated ${status.length} entries to ${PROGRESS_REVIEW_MAX_GIT_STATUS_LINES}`,
      );
    }
    return status
      .slice(0, PROGRESS_REVIEW_MAX_GIT_STATUS_LINES)
      .map((line, index) => ({
        id: sourceEvidenceId(source, `git:status:${index + 1}`),
        kind: "git" as const,
        gitKind: "worktree-status" as const,
        statusLine: line,
        summary: sourceSummary(source, `worktree ${line}`),
      }));
  } catch {
    excluded.push(`${source.displayName} git: status unavailable`);
    return [];
  }
}

function gitCommitFiles(
  source: ProgressReviewDirectorySource,
  commit: string,
  committedAt: string,
  excluded: string[],
): ProgressReviewGitEvidence[] {
  const short = shortCommit(commit);
  const files = gitLines(source.projectDir, [
    "diff-tree",
    "--root",
    "--no-commit-id",
    "--name-status",
    "-r",
    commit,
  ]);
  if (files.length > PROGRESS_REVIEW_MAX_GIT_FILES_PER_COMMIT) {
    excluded.push(
      `${source.displayName} git commit ${short}: truncated ${files.length} changed files to ${PROGRESS_REVIEW_MAX_GIT_FILES_PER_COMMIT}`,
    );
  }
  return files.slice(0, PROGRESS_REVIEW_MAX_GIT_FILES_PER_COMMIT).map((line, index) => {
    const parts = line.split("\t");
    const change = parts[0] ?? "change";
    const file = parts[parts.length - 1] ?? line;
    return {
      id: sourceEvidenceId(source, `git:commit:${short}:file:${index + 1}`),
      kind: "git" as const,
      gitKind: "commit-file" as const,
      commit,
      committedAt,
      change,
      file,
      path: file,
      summary: sourceSummary(source, `commit ${short} ${change} ${file}`),
    };
  });
}

function listGitCommitEvidence(
  source: ProgressReviewDirectorySource,
  windowStartMs: number,
  excluded: string[],
): ProgressReviewGitEvidence[] {
  if (!hasGitHead(source.projectDir)) return [];
  try {
    const commits = gitLines(source.projectDir, [
      "log",
      `--since=${new Date(windowStartMs).toISOString()}`,
      `--max-count=${PROGRESS_REVIEW_MAX_GIT_COMMITS}`,
      "--format=%H%x00%ct%x00%s",
    ]);
    const evidence: ProgressReviewGitEvidence[] = [];
    for (const line of commits) {
      const [commit, unixSeconds, subject] = line.split("\0");
      if (!commit || !unixSeconds || subject === undefined) continue;
      const committedAt = commitTimestamp(unixSeconds);
      if (!committedAt) continue;
      const short = shortCommit(commit);
      evidence.push({
        id: sourceEvidenceId(source, `git:commit:${short}`),
        kind: "git",
        gitKind: "commit",
        commit,
        committedAt,
        summary: sourceSummary(source, `commit ${short}: ${subject}`),
      });
      evidence.push(...gitCommitFiles(source, commit, committedAt, excluded));
    }
    return evidence;
  } catch {
    excluded.push(`${source.displayName} git: recent commits unavailable`);
    return [];
  }
}

export function listScopedGitEvidence(
  sources: readonly ProgressReviewDirectorySource[],
  windowStartMs: number,
  excluded: string[],
): ProgressReviewGitEvidence[] {
  const evidence = sources.flatMap((source) => [
    ...listGitStatusEvidence(source, excluded),
    ...listGitCommitEvidence(source, windowStartMs, excluded),
  ]);
  if (evidence.length > PROGRESS_REVIEW_MAX_GIT_ENTRIES) {
    excluded.push(
      `git: truncated ${evidence.length} status and commit entries to ${PROGRESS_REVIEW_MAX_GIT_ENTRIES}`,
    );
  }
  return evidence.slice(0, PROGRESS_REVIEW_MAX_GIT_ENTRIES);
}
