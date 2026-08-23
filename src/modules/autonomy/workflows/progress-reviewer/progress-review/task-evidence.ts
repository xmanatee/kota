import { join } from "node:path";
import { mentionsOperatorEvidence } from "#modules/autonomy/product-evidence.js";
import { classifyStoredWorkflowGeneratedTask } from "#modules/autonomy/workflow-generated-task-class.js";
import {
  listFullRepoTasks,
  type RepoTaskClass,
  type RepoTaskFullRecord,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { PROGRESS_REVIEW_MAX_TASKS } from "./constants.js";
import { sourceEvidenceId, sourceSummary } from "./trigger-target.js";
import type {
  ProgressReviewDeadLetterEvidence,
  ProgressReviewDirectorySource,
  ProgressReviewOperatorJourneyRisk,
  ProgressReviewTaskClassCount,
  ProgressReviewTaskEvidence,
} from "./types.js";

const TASK_PATH_REFERENCE_RE =
  /\bdata\/tasks\/(?:backlog|ready|doing|blocked|done|dropped)\/(task-[A-Za-z0-9-]+)\.md\b/g;
const TASK_EVIDENCE_ID_REFERENCE_RE = /\btask:(task-[A-Za-z0-9-]+)\b/g;

function summarizeTask(
  source: ProgressReviewDirectorySource,
  record: RepoTaskFullRecord,
  stateByTaskId: ReadonlyMap<string, RepoTaskFullRecord["state"]> = new Map(),
): ProgressReviewTaskEvidence {
  const taskClass = record.taskClass === "Unclassified"
    ? classifyStoredWorkflowGeneratedTask(record) ?? record.taskClass
    : record.taskClass;
  const waitingOn = record.dependsOn.filter((id) => {
    const state = stateByTaskId.get(id);
    return state !== "done" && state !== "dropped";
  });
  return {
    id: sourceEvidenceId(source, `task:${record.id}`),
    kind: "task",
    taskId: record.id,
    title: record.title,
    state: record.state,
    updatedAt: record.updatedAt,
    priority: record.priority,
    area: record.area,
    taskClass,
    anchor: record.anchor,
    dependsOn: [...record.dependsOn],
    waitingOn,
    operatorEvidenceMentioned: taskMentionsOperatorEvidence(record),
    path: join("data", "tasks", record.state, `${record.id}.md`),
    summary: sourceSummary(
      source,
      `${record.id} ${record.state}${record.anchor ? " strategic-anchor" : ""}: ` +
        `${record.title}; dependsOn=${record.dependsOn.join(",") || "none"}; ` +
        `waitingOn=${waitingOn.join(",") || "none"}`,
    ),
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
  const openStates = new Set(["backlog", "ready", "doing", "blocked"]);
  const records = sources.flatMap((source) => {
    const all = listFullRepoTasks(source.projectDir);
    const stateByTaskId = new Map(all.map((record) => [record.id, record.state]));
    const open = all.filter((record) => openStates.has(record.state));
    const recentTerminal = all.filter((record) => {
      if (openStates.has(record.state)) return false;
      const updatedMs = Date.parse(record.updatedAt);
      return Number.isFinite(updatedMs) && updatedMs >= windowStartMs;
    });
    recentTerminal.sort((a, b) =>
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt) || a.id.localeCompare(b.id)
    );
    if (recentTerminal.length > PROGRESS_REVIEW_MAX_TASKS) {
      excluded.push(
        `terminal tasks: truncated ${recentTerminal.length} recent records to ${PROGRESS_REVIEW_MAX_TASKS}; the open queue remains complete`,
      );
    }
    return [...open, ...recentTerminal.slice(0, PROGRESS_REVIEW_MAX_TASKS)].map(
      (record) => ({ source, record, stateByTaskId }),
    );
  });
  records.sort((a, b) => {
    const byUpdated = Date.parse(b.record.updatedAt) - Date.parse(a.record.updatedAt);
    if (byUpdated !== 0) return byUpdated;
    return sourceEvidenceId(a.source, a.record.id).localeCompare(
      sourceEvidenceId(b.source, b.record.id),
    );
  });

  return records
    .map(({ source, record, stateByTaskId }) =>
      summarizeTask(source, record, stateByTaskId)
    );
}

function referencedTaskIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(TASK_PATH_REFERENCE_RE)) {
    if (match[1]) ids.add(match[1]);
  }
  for (const match of text.matchAll(TASK_EVIDENCE_ID_REFERENCE_RE)) {
    if (match[1]) ids.add(match[1]);
  }
  return [...ids];
}

export function listDeadLetterReferencedTasks(
  source: ProgressReviewDirectorySource,
  deadLetters: readonly ProgressReviewDeadLetterEvidence[],
  existingTasks: readonly ProgressReviewTaskEvidence[],
  excluded: string[],
): ProgressReviewTaskEvidence[] {
  if (deadLetters.length === 0) return [];

  const existingTaskIds = new Set(existingTasks.map((task) => task.taskId));
  const recordsById = new Map(
    listFullRepoTasks(source.projectDir).map((record) => [record.id, record]),
  );
  const selected = new Set<string>();
  const tasks: ProgressReviewTaskEvidence[] = [];

  for (const deadLetter of deadLetters) {
    for (const taskId of referencedTaskIds(deadLetter.reason)) {
      if (existingTaskIds.has(taskId) || selected.has(taskId)) continue;
      const record = recordsById.get(taskId);
      if (!record) {
        excluded.push(
          `dead letters: referenced task ${taskId} was not found in current task files`,
        );
        continue;
      }
      selected.add(taskId);
      tasks.push(summarizeTask(source, record));
    }
  }

  return tasks;
}

export function taskClassDistribution(
  tasks: readonly ProgressReviewTaskEvidence[],
): ProgressReviewTaskClassCount[] {
  const counts = new Map<RepoTaskClass, number>();
  for (const task of tasks) {
    if (task.state === "done" || task.state === "dropped") continue;
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
