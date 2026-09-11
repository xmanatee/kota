import { UNKNOWN_AGENT_USAGE } from "#core/agent-harness/index.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import type { PostCompletionFollowUpReport } from "./post-completion-followups.js";
import { buildQualityStratificationReport } from "./quality-stratification.js";

export const NOW = Date.parse("2026-04-29T12:00:00.000Z");
export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const WINDOW_START = NOW - 7 * MS_PER_DAY;
export const PRIOR_START = WINDOW_START - 7 * MS_PER_DAY;

export function buildReport(
  runsDir: string,
  overrides: {
    tasks: RepoTaskFullRecord[];
    runs: WorkflowRunMetadata[];
    postCompletionFollowUps?: PostCompletionFollowUpReport;
    priorPostCompletionFollowUps?: PostCompletionFollowUpReport;
  },
) {
  return buildQualityStratificationReport({
    tasks: overrides.tasks,
    runs: overrides.runs,
    runsDir,
    windowStartMs: WINDOW_START,
    windowEndMs: NOW,
    postCompletionFollowUps: overrides.postCompletionFollowUps ?? emptyPostReport(),
    priorPostCompletionFollowUps: overrides.priorPostCompletionFollowUps ?? emptyPostReport(),
  });
}

export function task(
  id: string,
  state: RepoTaskFullRecord["state"],
  body = "## Problem\n\nTest task.\n",
): RepoTaskFullRecord {
  return {
    id,
    title: id,
    state,
    priority: "p2",
    body,
    dependsOn: [],
  };
}

export function run(
  id: string,
  workflow: string,
  startedMs: number,
  harness: string | undefined,
  taskId?: string,
): WorkflowRunMetadata {
  const taskDigest = "0".repeat(64);
  return {
    id,
    workflow,
    definitionPath: `src/modules/autonomy/workflows/${workflow}/workflow.ts`,
    trigger: taskId === undefined
      ? { event: "test", schemaRef: null, payload: {} }
      : {
          event: "autonomy.queue.available",
          schemaRef: null,
          payload: {
            taskId,
            taskPath: `data/tasks/${taskId}.md`,
            taskState: "open",
            taskDigest,
            idempotencyKey: `builder:${taskId}:${taskDigest}`,
            title: taskId,
          },
        },
    startedAt: new Date(startedMs).toISOString(),
    completedAt: new Date(startedMs + 1000).toISOString(),
    status: "success",
    durationMs: 1000,
    runDir: `.kota/runs/${id}`,
    steps: [
      {
        id: "build",
        type: "agent",
        status: "success",
        startedAt: new Date(startedMs).toISOString(),
        completedAt: new Date(startedMs + 1000).toISOString(),
        durationMs: 1000,
        usage: UNKNOWN_AGENT_USAGE,
        harness,
      },
    ],
  };
}

export function postReport(
  completedTaskId: string,
  followUpTaskId: string,
  reasons: PostCompletionFollowUpReport["links"][number]["reasons"],
): PostCompletionFollowUpReport {
  return {
    totalCorrectiveFollowUps: 1,
    linkedCompletedTaskCount: 1,
    byReason: reasons.map((reason) => ({ reason, count: 1 })),
    completedTaskIds: [completedTaskId],
    activeFollowUpTaskIds: [followUpTaskId],
    links: [
      {
        completedTaskId,
        completedTaskTitle: completedTaskId,
        activeFollowUpTaskId: followUpTaskId,
        activeFollowUpTitle: followUpTaskId,
        activeFollowUpState: "open",
        reasons,
        matchedRefs: [],
        sourceRunIds: [],
        sourceCommitRefs: [],
        sourceArtifactPaths: [],
      },
    ],
    truncatedLinkCount: 0,
  };
}

function emptyPostReport(): PostCompletionFollowUpReport {
  return {
    totalCorrectiveFollowUps: 0,
    linkedCompletedTaskCount: 0,
    byReason: [],
    completedTaskIds: [],
    activeFollowUpTaskIds: [],
    links: [],
    truncatedLinkCount: 0,
  };
}

export function slice(
  report: ReturnType<typeof buildQualityStratificationReport>,
  signal: string,
  dimension: string,
  value: string,
) {
  return report.slices.find((candidate) =>
    candidate.signal === signal &&
    candidate.dimension === dimension &&
    candidate.value === value
  );
}
