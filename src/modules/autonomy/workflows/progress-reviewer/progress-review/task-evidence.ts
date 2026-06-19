import { join } from "node:path";
import { mentionsOperatorEvidence } from "#modules/autonomy/product-evidence.js";
import {
  listFullRepoTasks,
  type RepoTaskClass,
  type RepoTaskFullRecord,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { PROGRESS_REVIEW_MAX_TASKS } from "./constants.js";
import { sourceEvidenceId, sourceSummary } from "./trigger-target.js";
import type {
  ProgressReviewDirectorySource,
  ProgressReviewOperatorJourneyRisk,
  ProgressReviewTaskClassCount,
  ProgressReviewTaskEvidence,
} from "./types.js";

function summarizeTask(
  source: ProgressReviewDirectorySource,
  record: RepoTaskFullRecord,
): ProgressReviewTaskEvidence {
  return {
    id: sourceEvidenceId(source, `task:${record.id}`),
    kind: "task",
    taskId: record.id,
    title: record.title,
    state: record.state,
    updatedAt: record.updatedAt,
    priority: record.priority,
    area: record.area,
    taskClass: record.taskClass,
    operatorEvidenceMentioned: taskMentionsOperatorEvidence(record),
    path: join("data", "tasks", record.state, `${record.id}.md`),
    summary: sourceSummary(source, `${record.id} ${record.state}: ${record.title}`),
  };
}

function taskMentionsOperatorEvidence(record: RepoTaskFullRecord): boolean {
  return mentionsOperatorEvidence(
    [record.title, record.summary, record.body].join("\n"),
  );
}

export function listRecentTasks(
  sources: readonly ProgressReviewDirectorySource[],
  windowStartMs: number,
  excluded: string[],
): ProgressReviewTaskEvidence[] {
  const records = sources.flatMap((source) =>
    listFullRepoTasks(source.projectDir)
      .filter((record) => {
        const updatedMs = Date.parse(record.updatedAt);
        return Number.isFinite(updatedMs) && updatedMs >= windowStartMs;
      })
      .map((record) => ({ source, record })),
  );
  records.sort((a, b) => {
    const byUpdated = Date.parse(b.record.updatedAt) - Date.parse(a.record.updatedAt);
    if (byUpdated !== 0) return byUpdated;
    return sourceEvidenceId(a.source, a.record.id).localeCompare(
      sourceEvidenceId(b.source, b.record.id),
    );
  });

  if (records.length > PROGRESS_REVIEW_MAX_TASKS) {
    excluded.push(`tasks: truncated ${records.length} updated tasks to ${PROGRESS_REVIEW_MAX_TASKS}`);
  }
  return records
    .slice(0, PROGRESS_REVIEW_MAX_TASKS)
    .map(({ source, record }) => summarizeTask(source, record));
}

export function taskClassDistribution(
  tasks: readonly ProgressReviewTaskEvidence[],
): ProgressReviewTaskClassCount[] {
  const counts = new Map<RepoTaskClass, number>();
  for (const task of tasks) {
    counts.set(task.taskClass, (counts.get(task.taskClass) ?? 0) + 1);
  }
  const order = new Map<RepoTaskClass, number>([
    ["Safety", 0],
    ["Product", 1],
    ["Platform", 2],
    ["Meta", 3],
    ["Unclassified", 4],
  ]);
  return [...counts.entries()]
    .map(([taskClass, count]) => ({ taskClass, count }))
    .sort(
      (a, b) =>
        (order.get(a.taskClass) ?? 9) - (order.get(b.taskClass) ?? 9) ||
        a.taskClass.localeCompare(b.taskClass),
    );
}

export function operatorJourneyRisks(
  tasks: readonly ProgressReviewTaskEvidence[],
): ProgressReviewOperatorJourneyRisk[] {
  return tasks
    .filter(
      (task) =>
        task.taskClass === "Product" &&
        task.state === "done" &&
        !task.operatorEvidenceMentioned,
    )
    .map((task) => ({
      taskId: task.taskId,
      title: task.title,
      state: task.state,
      evidenceId: task.id,
      reason:
        "Product task moved to done without transcript, screenshot, runtime probe, rendered fixture, trace, snapshot, demo, or equivalent evidence in the task record.",
    }))
    .sort((a, b) => a.taskId.localeCompare(b.taskId));
}
