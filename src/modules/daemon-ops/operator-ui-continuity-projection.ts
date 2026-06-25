import type { PendingApproval } from "#core/daemon/approval-queue.js";
import type { PendingOwnerQuestion } from "#core/daemon/owner-question-queue.js";
import type { KnowledgeListResult } from "#modules/knowledge/client.js";
import type { MemoryListResult } from "#modules/memory/client.js";
import type { OwnerDecisionListResult } from "#modules/owner-decisions/client.js";
import type { RepoTaskListResult } from "#modules/repo-tasks/client.js";
import type { ModuleSetupStatusResponse } from "#modules/setup/client.js";
import type { WorkflowDefinitionsResult, WorkflowRunsListResult, WorkflowStatusSnapshot } from "#modules/workflow-ops/client.js";
import { type SurfaceRead, scopeIdForStatus } from "./operator-ui-builder-common.js";
import {
  approvalEntries,
  memoryKnowledgeEntries,
  ownerDecisionEntries,
  ownerQuestionEntries,
  recentRunEntries,
  recurringEntries,
  reviewArtifactEntries,
  runWorkEntries,
  setupEntries,
  taskEntries,
} from "./operator-ui-continuity-entries.js";
import { CONTINUITY_COMPOSED_STORES, type ContinuityEntry, type ContinuityProjection, type ContinuityState } from "./operator-ui-continuity-model.js";
import type { StatusSnapshot } from "./status-cli.js";

export type ContinuityProjectionInput = {
  status: StatusSnapshot;
  tasks: SurfaceRead<RepoTaskListResult>;
  workflowStatus: SurfaceRead<WorkflowStatusSnapshot>;
  runs: SurfaceRead<WorkflowRunsListResult>;
  definitions: SurfaceRead<WorkflowDefinitionsResult>;
  approvals: SurfaceRead<{ approvals: PendingApproval[] }>;
  ownerQuestions: SurfaceRead<{ questions: PendingOwnerQuestion[] }>;
  ownerDecisions: SurfaceRead<OwnerDecisionListResult>;
  setup: SurfaceRead<ModuleSetupStatusResponse>;
  memory: SurfaceRead<MemoryListResult>;
  knowledge: SurfaceRead<KnowledgeListResult>;
};

function statusFrom(args: {
  workItems: readonly ContinuityEntry[];
  unblocks: readonly ContinuityEntry[];
  failedRuns: number;
  reviewArtifacts: readonly ContinuityEntry[];
  memoryKnowledgeHints: readonly ContinuityEntry[];
  recurringFollowUps: readonly ContinuityEntry[];
}): ContinuityState {
  if (args.failedRuns > 0) return "failed";
  if (args.unblocks.length > 0) return "blocked";
  if (
    args.workItems.length === 0 &&
    args.reviewArtifacts.length === 0 &&
    args.memoryKnowledgeHints.length === 0 &&
    args.recurringFollowUps.length === 0
  ) {
    return "empty";
  }
  return "healthy";
}

export function buildContinuityProjection(input: ContinuityProjectionInput): ContinuityProjection {
  const tasks = taskEntries(input.tasks);
  const recentRuns = recentRunEntries(input.runs);
  const workItems = [...tasks.work, ...runWorkEntries(input.workflowStatus), ...recentRuns].slice(0, 8);
  const unblocks = [
    ...tasks.blocked,
    ...approvalEntries(input.approvals),
    ...ownerQuestionEntries(input.ownerQuestions),
    ...ownerDecisionEntries(input.ownerDecisions),
    ...setupEntries(input.setup),
  ].slice(0, 10);
  const reviewArtifacts = reviewArtifactEntries(input.runs);
  const memoryKnowledgeHints = memoryKnowledgeEntries({
    memory: input.memory,
    knowledge: input.knowledge,
  });
  const recurringFollowUps = recurringEntries(input.definitions);
  const failedRuns = input.runs.ok
    ? input.runs.value.runs.filter((run) => run.status === "failed").length
    : 0;
  const state = statusFrom({
    workItems,
    unblocks,
    failedRuns,
    reviewArtifacts,
    memoryKnowledgeHints,
    recurringFollowUps,
  });
  return {
    scopeId: scopeIdForStatus(input.status),
    state,
    summary: state === "failed"
      ? `${failedRuns} failed run(s) need review.`
      : state === "blocked"
        ? `${unblocks.length} unblock item(s) need operator attention.`
        : state === "empty"
          ? "No durable work is active or waiting for attention."
          : "Nothing needs attention; recent work remains reviewable.",
    nextAction: state === "failed"
      ? "Inspect the failed run artifact before resuming this workstream."
      : state === "blocked"
        ? "Resolve the first unblock item, then refresh continuity."
        : state === "empty"
          ? "No operator action is needed."
          : "Review recent artifacts or continue the active task when needed.",
    composedStores: CONTINUITY_COMPOSED_STORES,
    counts: {
      workItems: workItems.length,
      unblocks: unblocks.length,
      failedRuns,
      reviewArtifacts: reviewArtifacts.length,
      memoryHints: input.memory.ok ? Math.min(3, input.memory.value.entries.length) : 0,
      knowledgeHints: input.knowledge.ok ? Math.min(3, input.knowledge.value.entries.length) : 0,
      recurringFollowUps: recurringFollowUps.length,
    },
    workItems,
    unblocks,
    reviewArtifacts,
    memoryKnowledgeHints,
    recurringFollowUps,
  };
}
