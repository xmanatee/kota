import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { WorkflowRunSummary } from "#modules/autonomy/run-summary.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  buildCompletedTaskEvidenceRefs,
  classifyCorrectiveReasons,
  extractFollowUpEvidenceRefs,
  findMatchedRefs,
  hasHardCorrectiveReason,
  isBlockedOperatorCapture,
  isPlannedContinuation,
} from "./post-completion-followup-detection.js";
import {
  type BuilderEvidence,
  type BuildPostCompletionFollowUpReportInput,
  type EvidenceRefs,
  POST_COMPLETION_FOLLOW_UP_REASONS,
  type PostCompletionCorrectiveLink,
  type PostCompletionCorrectiveReason,
  type PostCompletionFollowUpReasonCount,
  type PostCompletionFollowUpReport,
} from "./post-completion-followup-types.js";

export {
  type BuildPostCompletionFollowUpReportInput,
  POST_COMPLETION_FOLLOW_UP_REASONS,
  type PostCompletionCorrectiveLink,
  type PostCompletionCorrectiveReason,
  type PostCompletionFollowUpReasonCount,
  type PostCompletionFollowUpReport,
} from "./post-completion-followup-types.js";

const OPEN_TASK_STATES = new Set(["backlog", "ready", "doing", "blocked"]);
export const POST_COMPLETION_FOLLOW_UP_LINK_LIMIT = 12;

type CompletedTaskEvidence = {
  task: RepoTaskFullRecord;
  refs: EvidenceRefs;
};

export function buildPostCompletionFollowUpReport(
  input: BuildPostCompletionFollowUpReportInput,
): PostCompletionFollowUpReport {
  return summarizePostCompletionFollowUpLinks(
    buildPostCompletionCorrectiveLinks(input),
  );
}

export function buildPostCompletionCorrectiveLinks(
  input: BuildPostCompletionFollowUpReportInput,
): PostCompletionCorrectiveLink[] {
  const builderEvidenceByTaskId = buildBuilderEvidenceByTaskId(
    input.runs,
    input.runsDir,
  );
  const completedEvidence = input.tasks
    .filter((task) =>
      task.state === "done" &&
      taskUpdatedAtMs(task) >= input.windowStartMs &&
      taskUpdatedAtMs(task) <= input.windowEndMs
    )
    .map((task) => ({
      task,
      refs: buildCompletedTaskEvidenceRefs(
        task,
        builderEvidenceByTaskId.get(task.id) ?? [],
      ),
    }));

  const openTasks = input.tasks.filter((task) =>
    OPEN_TASK_STATES.has(task.state) && !isBlockedOperatorCapture(task)
  );
  const links: PostCompletionCorrectiveLink[] = [];

  for (const completed of completedEvidence) {
    const completedAtMs = taskUpdatedAtMs(completed.task);
    for (const followUp of openTasks) {
      const link = buildCorrectiveLink(completed, followUp, completedAtMs);
      if (link) links.push(link);
    }
  }

  return links.sort(compareLinks);
}

export function summarizePostCompletionFollowUpLinks(
  links: readonly PostCompletionCorrectiveLink[],
): PostCompletionFollowUpReport {
  const sortedLinks = [...links].sort(compareLinks);
  const activeFollowUpTaskIds = sortedUnique(
    sortedLinks.map((link) => link.activeFollowUpTaskId),
  );
  const completedTaskIds = sortedUnique(
    sortedLinks.map((link) => link.completedTaskId),
  );

  return {
    totalCorrectiveFollowUps: activeFollowUpTaskIds.length,
    linkedCompletedTaskCount: completedTaskIds.length,
    byReason: buildReasonCounts(sortedLinks),
    completedTaskIds,
    activeFollowUpTaskIds,
    links: sortedLinks.slice(0, POST_COMPLETION_FOLLOW_UP_LINK_LIMIT),
    truncatedLinkCount: Math.max(
      0,
      sortedLinks.length - POST_COMPLETION_FOLLOW_UP_LINK_LIMIT,
    ),
  };
}

function buildCorrectiveLink(
  completed: CompletedTaskEvidence,
  followUp: RepoTaskFullRecord,
  completedAtMs: number,
): PostCompletionCorrectiveLink | null {
  if (taskUpdatedAtMs(followUp) < completedAtMs) return null;
  const reasons = classifyCorrectiveReasons(followUp);
  if (reasons.length === 0) return null;
  if (isPlannedContinuation(followUp) && !hasHardCorrectiveReason(reasons)) {
    return null;
  }
  const matchedRefs = findMatchedRefs(
    completed.refs,
    extractFollowUpEvidenceRefs(followUp),
  );
  if (matchedRefs.length === 0) return null;
  return buildLink(completed.task, followUp, reasons, matchedRefs);
}

function buildBuilderEvidenceByTaskId(
  runs: readonly WorkflowRunMetadata[],
  runsDir: string,
): Map<string, BuilderEvidence[]> {
  const evidence = new Map<string, BuilderEvidence[]>();
  for (const run of runs) {
    if (run.workflow !== "builder") continue;
    if (run.status !== "success" && run.status !== "completed-with-warnings") {
      continue;
    }
    const summary = readOptionalJsonFile<WorkflowRunSummary>(
      join(runsDir, run.id, "run-summary.json"),
    );
    if (!summary?.taskId || !summary.commitSha) continue;
    const existing = evidence.get(summary.taskId) ?? [];
    existing.push({ runId: run.id, commitSha: summary.commitSha });
    evidence.set(summary.taskId, existing);
  }
  return evidence;
}

function buildLink(
  completedTask: RepoTaskFullRecord,
  followUpTask: RepoTaskFullRecord,
  reasons: PostCompletionCorrectiveReason[],
  matchedRefs: string[],
): PostCompletionCorrectiveLink {
  return {
    completedTaskId: completedTask.id,
    completedTaskTitle: completedTask.title,
    activeFollowUpTaskId: followUpTask.id,
    activeFollowUpTitle: followUpTask.title,
    activeFollowUpState: followUpTask.state,
    reasons,
    matchedRefs,
    sourceRunIds: refsByPrefix(matchedRefs, "run:"),
    sourceCommitRefs: refsByPrefix(matchedRefs, "git:commit:"),
    sourceArtifactPaths: refsByPrefix(matchedRefs, "artifact:"),
  };
}

function buildReasonCounts(
  links: readonly PostCompletionCorrectiveLink[],
): PostCompletionFollowUpReasonCount[] {
  const counts = new Map<PostCompletionCorrectiveReason, Set<string>>();
  for (const link of links) {
    for (const reason of link.reasons) {
      const taskIds = counts.get(reason) ?? new Set<string>();
      taskIds.add(link.activeFollowUpTaskId);
      counts.set(reason, taskIds);
    }
  }
  return POST_COMPLETION_FOLLOW_UP_REASONS
    .map((reason) => ({ reason, count: counts.get(reason)?.size ?? 0 }))
    .filter((row) => row.count > 0);
}

function taskUpdatedAtMs(task: RepoTaskFullRecord): number {
  const ms = Date.parse(task.updatedAt);
  return Number.isNaN(ms) ? 0 : ms;
}

function refsByPrefix(refs: readonly string[], prefix: string): string[] {
  return refs
    .filter((ref) => ref.startsWith(prefix))
    .map((ref) => ref.slice(prefix.length));
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function compareLinks(
  left: PostCompletionCorrectiveLink,
  right: PostCompletionCorrectiveLink,
): number {
  return left.completedTaskId.localeCompare(right.completedTaskId) ||
    left.activeFollowUpTaskId.localeCompare(right.activeFollowUpTaskId);
}
