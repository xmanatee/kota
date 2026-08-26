import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type {
  ReviewScrutinyRecord,
  ReviewScrutinyReport,
} from "#modules/autonomy/review-scrutiny.js";
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
    reviewScrutiny?: ReviewScrutinyReport;
    priorReviewScrutiny?: ReviewScrutinyReport;
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
    reviewScrutiny: overrides.reviewScrutiny ?? reviewReport([]),
    priorReviewScrutiny: overrides.priorReviewScrutiny ?? reviewReport([]),
    postCompletionFollowUps: overrides.postCompletionFollowUps ?? emptyPostReport(),
    priorPostCompletionFollowUps: overrides.priorPostCompletionFollowUps ?? emptyPostReport(),
  });
}

export function task(
  id: string,
  state: RepoTaskFullRecord["state"],
  area: string,
  body = "## Problem\n\nTest task.\n",
): RepoTaskFullRecord {
  return {
    id,
    title: id,
    state,
    priority: "p2",
    area,
    taskClass: area === "security" ? "Safety" : "Meta",
    summary: "test",
    updatedAt: new Date(WINDOW_START + MS_PER_DAY).toISOString(),
    body,
    dependsOn: [],
    anchor: false,
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
            taskPath: `data/tasks/ready/${taskId}.md`,
            taskState: "ready",
            taskUpdatedAt: new Date(startedMs).toISOString(),
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
        harness,
      },
    ],
  };
}

export function reviewRuns(
  prefix: string,
  workflow: string,
  harness: string,
  count: number,
  startedMs: number,
): WorkflowRunMetadata[] {
  return Array.from({ length: count }, (_, index) =>
    run(`${prefix}-${index}`, workflow, startedMs + index, harness)
  );
}

export function reviewRecords(
  prefix: string,
  workflow: string,
  taskId: string,
  count: number,
  thinCount: number,
): ReviewScrutinyRecord[] {
  return Array.from({ length: count }, (_, index) =>
    reviewRecord(`${prefix}-${index}`, "critic", workflow, index < thinCount, taskId)
  );
}

export function reviewRecord(
  runId: string,
  surface: ReviewScrutinyRecord["surface"],
  workflow: string,
  thinAcceptance: boolean,
  taskId: string | undefined,
): ReviewScrutinyRecord {
  return {
    schemaVersion: 2,
    surface,
    runId,
    workflow,
    generatedAt: new Date(NOW).toISOString(),
    artifact: "critic-review.json",
    taskId,
    decision: "pass",
    signals: {},
    absentMetrics: [],
    thinAcceptance,
  };
}

export function reviewReport(records: ReviewScrutinyRecord[]): ReviewScrutinyReport {
  return {
    totalReviews: records.length,
    approvalLikeDecisions: records.length,
    thinAcceptances: records.filter((record) => record.thinAcceptance).length,
    absentMetricCount: 0,
    unsupportedArtifacts: 0,
    bySurface: [],
    thinAcceptanceRefs: [],
    absentMetricRefs: [],
    records,
    unsupported: [],
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
        activeFollowUpState: "ready",
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
