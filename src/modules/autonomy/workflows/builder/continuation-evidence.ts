import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import type { WorkflowRepairContinuationInput } from "#core/workflow/run-types.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";

const MATERIAL_CHANGED_FILES = 12;
const MATERIAL_CHANGED_LINES = 1_200;
const MAX_DIFF_CONTENT_CHARS = 80_000;

export type BuilderContinuationDiff = {
  files: string[];
  insertions: number;
  deletions: number;
  content: string;
};

function gitOutput(workspaceDir: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: workspaceDir,
    env: withProtectedGitBareRepositoryEnv(),
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  }
  return result.stdout;
}

export function inspectContinuationDiff(
  workspaceDir: string,
): BuilderContinuationDiff {
  const files = gitOutput(workspaceDir, ["diff", "--name-only", "HEAD", "--"])
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
  let insertions = 0;
  let deletions = 0;
  for (const line of gitOutput(workspaceDir, ["diff", "--numstat", "HEAD", "--"])
    .split("\n")) {
    const [added, removed] = line.split("\t");
    if (added && added !== "-") insertions += Number(added) || 0;
    if (removed && removed !== "-") deletions += Number(removed) || 0;
  }
  return {
    files,
    insertions,
    deletions,
    content: gitOutput(workspaceDir, [
      "diff",
      "--no-ext-diff",
      "--unified=3",
      "HEAD",
      "--",
    ]).slice(0, MAX_DIFF_CONTENT_CHARS),
  };
}

function numberedCriteriaLines(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => /^\d+[.)]\s/.test(line));
}

export function countNumberedCriteria(path: string): number {
  return numberedCriteriaLines(path).length;
}

export function countVerifiedNumberedCriteria(path: string): number {
  return numberedCriteriaLines(path).filter(
    (line) => !/^\d+[.)]\s+(?:not\s+verified|unverified|blocked)\b/i.test(line),
  ).length;
}

export function builderTaskContract(task: RepoTaskFullRecord): string {
  return [
    `${task.id}: ${task.title}`,
    `priority=${task.priority}; task_class=${task.taskClass}; state=${task.state}`,
    task.summary,
    task.body,
  ].join("\n\n");
}

export function sortedContinuationIds(ids: string[]): string[] {
  return [...ids].sort((a, b) => a.localeCompare(b));
}

function sameIds(a: string[], b: string[]): boolean {
  return sortedContinuationIds(a).join("\0") === sortedContinuationIds(b).join("\0");
}

export function classifyBuilderRepairTrajectory(
  input: WorkflowRepairContinuationInput,
): string {
  const history = input.repairIterations.map((item) => item.failureIds);
  if (history.length < 2) return "fresh";
  const previous = history.at(-1) ?? input.failureIds;
  if (!input.progressChanged) return "unchanged";
  if (sameIds(input.failureIds, previous)) return "stalled-changing";
  const introduced = input.failureIds.filter((id) => !previous.includes(id));
  const resolved = previous.filter((id) => !input.failureIds.includes(id));
  if (introduced.length === 0 && resolved.length > 0) return "converging";
  if (introduced.length > 0 && resolved.length === 0) return "expanding";
  return "changing";
}

export function builderQueueRevision(tasks: RepoTaskFullRecord[]): string {
  const hash = createHash("sha256");
  for (const task of [...tasks].sort((a, b) => a.id.localeCompare(b.id))) {
    hash.update(
      `${task.id}\0${task.state}\0${task.priority}\0${task.taskClass}\0${task.updatedAt}\n`,
    );
  }
  return hash.digest("hex").slice(0, 16);
}

export function continuationBoundaryReasons(input: {
  continuation: WorkflowRepairContinuationInput;
  classification: string;
  diff: BuilderContinuationDiff;
  higherPriorityTask: RepoTaskFullRecord | null;
}): string[] {
  const reasons: string[] = [];
  if (input.higherPriorityTask !== null) {
    reasons.push(
      `higher-priority:${input.higherPriorityTask.id}:${input.higherPriorityTask.priority}:${input.higherPriorityTask.taskClass}`,
    );
  }
  if (
    input.diff.files.length >= MATERIAL_CHANGED_FILES ||
    input.diff.insertions + input.diff.deletions >= MATERIAL_CHANGED_LINES
  ) {
    reasons.push("material-scope-expansion");
  }
  if (
    input.classification === "stalled-changing" ||
    input.classification === "expanding"
  ) {
    reasons.push(`repair-trajectory:${input.classification}`);
  }
  const previousIteration = input.continuation.repairIterations.at(-1);
  const previousFailures = previousIteration?.failureIds ?? [];
  const newFailures = input.continuation.failureIds.filter(
    (id) => !previousFailures.includes(id),
  );
  if (previousIteration !== undefined && newFailures.length > 0) {
    reasons.push(`new-failures:${sortedContinuationIds(newFailures).join(",")}`);
  }
  if (
    input.continuation.failureIds.some((id) => /criteria|acceptance/i.test(id))
  ) {
    reasons.push("unresolved-acceptance-criteria");
  }
  return reasons;
}

export function continuationEvidenceKey(input: {
  reasons: string[];
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        reasons: sortedContinuationIds(input.reasons),
      }),
    )
    .digest("hex");
}
