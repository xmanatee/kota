import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type { WorkflowCommandRunner } from "#core/workflow/workflow-command.js";
import {
  PROGRESS_REVIEW_MAX_GIT_COMMITS,
  PROGRESS_REVIEW_MAX_GIT_ENTRIES,
  PROGRESS_REVIEW_MAX_GIT_FILES_PER_COMMIT,
  PROGRESS_REVIEW_MAX_GIT_STATUS_LINES,
} from "./constants.js";
import {
  readWindowMs,
  requestPayload,
  selectEvidenceTarget,
  sourceEvidenceId,
  sourceSummary,
} from "./trigger-target.js";
import type {
  ProgressReviewDirectorySource,
  ProgressReviewGitEvidence,
} from "./types.js";

export type ProgressReviewGitEvidenceByScope = Record<
  string,
  { evidence: ProgressReviewGitEvidence[]; excluded: string[] }
>;

function outputLines(output: string): string[] {
  return output.split(/\r?\n/).filter((line) => line.trim().length > 0);
}

async function tryGitLines(
  runCommand: WorkflowCommandRunner,
  workspaceRoot: string,
  args: readonly string[],
): Promise<string[] | null> {
  try {
    const result = await runCommand({
      command: "git",
      args,
      cwd: workspaceRoot,
      captureLimitBytesPerStream: 1_000_000,
    });
    return outputLines(result.stdout.text);
  } catch {
    return null;
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

function parseGitStatusEvidence(
  source: ProgressReviewDirectorySource,
  status: readonly string[],
  excluded: string[],
): ProgressReviewGitEvidence[] {
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
}

function parseGitCommitFiles(
  source: ProgressReviewDirectorySource,
  commit: string,
  committedAt: string,
  files: readonly string[],
  excluded: string[],
): ProgressReviewGitEvidence[] {
  const short = shortCommit(commit);
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

async function collectGitEvidenceForSource(
  source: ProgressReviewDirectorySource,
  windowStartMs: number,
  runCommand: WorkflowCommandRunner,
): Promise<{ evidence: ProgressReviewGitEvidence[]; excluded: string[] }> {
  const excluded: string[] = [];
  const status = await tryGitLines(runCommand, source.workspaceRoot, ["status", "--short"]);
  const statusEvidence = status
    ? parseGitStatusEvidence(source, status, excluded)
    : [];
  if (!status) excluded.push(`${source.displayName} git: status unavailable`);

  const hasHead = await tryGitLines(runCommand, source.workspaceRoot, [
    "rev-parse",
    "--verify",
    "HEAD",
  ]);
  if (!hasHead) return { evidence: statusEvidence, excluded };

  const commits = await tryGitLines(runCommand, source.workspaceRoot, [
    "log",
    `--since=${new Date(windowStartMs).toISOString()}`,
    `--max-count=${PROGRESS_REVIEW_MAX_GIT_COMMITS}`,
    "--format=%H%x00%ct%x00%s",
  ]);
  if (!commits) {
    excluded.push(`${source.displayName} git: recent commits unavailable`);
    return { evidence: statusEvidence, excluded };
  }

  const commitEvidence: ProgressReviewGitEvidence[] = [];
  for (const line of commits) {
    const [commit, unixSeconds, subject] = line.split("\0");
    if (!commit || !unixSeconds || subject === undefined) continue;
    const committedAt = commitTimestamp(unixSeconds);
    if (!committedAt) continue;
    const short = shortCommit(commit);
    commitEvidence.push({
      id: sourceEvidenceId(source, `git:commit:${short}`),
      kind: "git",
      gitKind: "commit",
      commit,
      committedAt,
      summary: sourceSummary(source, `commit ${short}: ${subject}`),
    });
    const files = await tryGitLines(runCommand, source.workspaceRoot, [
      "diff-tree",
      "--root",
      "--no-commit-id",
      "--name-status",
      "-r",
      commit,
    ]);
    if (!files) {
      excluded.push(`${source.displayName} git commit ${short}: files unavailable`);
      continue;
    }
    commitEvidence.push(
      ...parseGitCommitFiles(source, commit, committedAt, files, excluded),
    );
  }

  const evidence = [...statusEvidence, ...commitEvidence];
  if (evidence.length > PROGRESS_REVIEW_MAX_GIT_ENTRIES) {
    excluded.push(
      `git: truncated ${evidence.length} status and commit entries to ${PROGRESS_REVIEW_MAX_GIT_ENTRIES}`,
    );
  }
  return {
    evidence: evidence.slice(0, PROGRESS_REVIEW_MAX_GIT_ENTRIES),
    excluded,
  };
}

export async function collectProgressReviewGitEvidence(args: {
  workspaceRoot: string;
  scopeRoot: string;
  stateDir: string;
  trigger: WorkflowRunTrigger;
  now: Date;
  runCommand: WorkflowCommandRunner;
}): Promise<ProgressReviewGitEvidenceByScope> {
  const target = selectEvidenceTarget(
    args.workspaceRoot,
    args.scopeRoot,
    args.trigger,
    args.stateDir,
  );
  const windowStartMs = args.now.getTime() - readWindowMs(requestPayload(args.trigger));
  const entries = await Promise.all(
    target.sources.map(async (source) => [
      source.scopeId,
      await collectGitEvidenceForSource(source, windowStartMs, args.runCommand),
    ] as const),
  );
  return Object.fromEntries(entries);
}
