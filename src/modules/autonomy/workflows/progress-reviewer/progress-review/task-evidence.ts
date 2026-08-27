import { join } from "node:path";
import { mentionsOperatorEvidence } from "#modules/autonomy/product-evidence.js";
import {
  listFullRepoTasks,
  type RepoTaskFullRecord,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import { PROGRESS_REVIEW_MAX_TASKS } from "./constants.js";
import { sourceEvidenceId, sourceSummary } from "./trigger-target.js";
import type {
  ProgressReviewDeadLetterEvidence,
  ProgressReviewDirectorySource,
  ProgressReviewGitEvidence,
  ProgressReviewTaskEvidence,
} from "./types.js";

const TASK_PATH_REFERENCE_RE =
  /\bdata\/tasks\/(?:archive\/)?(task-[A-Za-z0-9-]+)\.md\b/g;
const TASK_EVIDENCE_ID_REFERENCE_RE = /\btask:(task-[A-Za-z0-9-]+)\b/g;

function summarizeTask(
  source: ProgressReviewDirectorySource,
  record: RepoTaskFullRecord,
  stateByTaskId: ReadonlyMap<string, RepoTaskFullRecord["state"]> = new Map(),
): ProgressReviewTaskEvidence {
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
    priority: record.priority,
    dependsOn: [...record.dependsOn],
    waitingOn,
    operatorEvidenceMentioned: taskMentionsOperatorEvidence(record),
    path: join(
      "data",
      "tasks",
      ...(record.state === "done" || record.state === "dropped" ? ["archive"] : []),
      `${record.id}.md`,
    ),
    summary: sourceSummary(
      source,
      `${record.id} ${record.state}: ` +
        `${record.title}; dependsOn=${record.dependsOn.join(",") || "none"}; ` +
        `waitingOn=${waitingOn.join(",") || "none"}`,
    ),
  };
}

function taskMentionsOperatorEvidence(record: RepoTaskFullRecord): boolean {
  return mentionsOperatorEvidence(
    [record.title, record.body].join("\n"),
  );
}

export function listRecentTasks(
  sources: readonly ProgressReviewDirectorySource[],
  windowStartMs: number,
  excluded: string[],
  gitEvidence: readonly ProgressReviewGitEvidence[] = [],
): ProgressReviewTaskEvidence[] {
  const openStates = new Set(["open", "blocked"]);
  const recentTerminalIds = new Set(
    gitEvidence.flatMap((item) => {
      if (item.gitKind !== "commit-file") return [];
      if (Date.parse(item.committedAt) < windowStartMs) return [];
      const match = item.file.match(/^data\/tasks\/archive\/(task-[A-Za-z0-9-]+)\.md$/);
      return match?.[1] ? [match[1]] : [];
    }),
  );
  const records = sources.flatMap((source) => {
    const all = listFullRepoTasks(source.workspaceRoot);
    const stateByTaskId = new Map(all.map((record) => [record.id, record.state]));
    const open = all.filter((record) => openStates.has(record.state));
    const recentTerminal = all
      .filter((record) => !openStates.has(record.state) && recentTerminalIds.has(record.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (recentTerminal.length > PROGRESS_REVIEW_MAX_TASKS) {
      excluded.push(
        `terminal tasks: truncated ${recentTerminal.length} recent records to ${PROGRESS_REVIEW_MAX_TASKS}; the open queue remains complete`,
      );
    }
    return [...open, ...recentTerminal.slice(0, PROGRESS_REVIEW_MAX_TASKS)].map(
      (record) => ({ source, record, stateByTaskId }),
    );
  });
  records.sort((a, b) =>
    sourceEvidenceId(a.source, a.record.id).localeCompare(
      sourceEvidenceId(b.source, b.record.id),
    )
  );

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
    listFullRepoTasks(source.workspaceRoot).map((record) => [record.id, record]),
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
