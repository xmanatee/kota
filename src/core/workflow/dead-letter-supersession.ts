import {
  type DeadLetterItem,
  type DeadLetterQueueStore,
  deadLetterWorkflowName,
} from "#core/daemon/dead-letter-queue.js";
import type { WorkflowRunStore } from "./run-store.js";
import type { WorkflowRunMetadata } from "./run-types.js";
import { classifyAgentRuntimeFailure } from "./steps/step-executor-retry.js";

function failureSubtype(reason: string): string | undefined {
  return /\(([^)]+)\):/.exec(reason)?.[1];
}

function isWorkflowMetadataAuthorityFailure(item: DeadLetterItem): boolean {
  return item.type === "workflow-dispatch" &&
    deadLetterWorkflowName(item) === "runtime-health-auditor" &&
    /workflow run metadata authority is invalid\b/i.test(item.failure.reason);
}

function isSupersedableWorkflowFailure(item: DeadLetterItem): boolean {
  if (item.type !== "workflow-dispatch") return false;
  if (
    item.failure.lastErrorClass === "auth" ||
    item.failure.lastErrorClass === "provider" ||
    item.failure.lastErrorClass === "rate_limit"
  ) {
    return true;
  }
  if (
    classifyAgentRuntimeFailure({
      message: item.failure.reason,
      subtype: failureSubtype(item.failure.reason),
    }) !== null
  ) {
    return true;
  }
  return /\b(?:agent )?step "[^"]+" timed out after \d+ms\b/i.test(
    item.failure.reason,
  ) || isWorkflowMetadataAuthorityFailure(item);
}

function failedStepId(
  item: DeadLetterItem,
  runStore: WorkflowRunStore,
): string | null {
  if (item.source.kind !== "workflow-dispatch" || !item.source.failedRunId) {
    return null;
  }
  const failedRun = runStore.getRun(item.source.failedRunId);
  return failedRun?.steps.find(
    (step) => step.status === "failed" && !step.continueOnFailure,
  )?.id ?? null;
}

function payloadString(
  run: WorkflowRunMetadata,
  key: string,
): string | undefined {
  const value = run.trigger.payload[key];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function runContinuesDeadLetter(
  item: DeadLetterItem,
  run: WorkflowRunMetadata,
  runStore: WorkflowRunStore,
): boolean {
  if (isWorkflowMetadataAuthorityFailure(item)) {
    const repair = runStore.retainedMetadataAuthorityRepair(item.failure.reason);
    return deadLetterWorkflowName(item) === run.workflow &&
      repair !== null &&
      Date.parse(run.startedAt) > Date.parse(repair.repairedAt);
  }
  if (payloadString(run, "redriveOf") === item.id) return true;
  if (
    item.source.kind !== "workflow-dispatch" ||
    item.source.failedRunId === undefined
  ) {
    return false;
  }
  const failedRunId = item.source.failedRunId;
  return (
    run.retryOf === failedRunId ||
    run.resumedFromRunId === failedRunId ||
    run.triggeredByRunId === failedRunId ||
    run.causedBy?.runId === failedRunId ||
    payloadString(run, "retryOf") === failedRunId ||
    payloadString(run, "resumedFromRunId") === failedRunId ||
    payloadString(run, "sourceRunId") === failedRunId
  );
}

function runSupersedesDeadLetter(
  item: DeadLetterItem,
  runStore: WorkflowRunStore,
  run: WorkflowRunMetadata,
): boolean {
  const failedAtMs = Date.parse(item.failure.lastFailedAt);
  if (!Number.isFinite(failedAtMs)) return false;
  if (run.status !== "success" && run.status !== "completed-with-warnings") {
    return false;
  }
  const completedAtMs = Date.parse(run.completedAt ?? run.startedAt);
  if (!Number.isFinite(completedAtMs) || completedAtMs <= failedAtMs) {
    return false;
  }
  if (!runContinuesDeadLetter(item, run, runStore)) return false;
  const stepId = failedStepId(item, runStore);
  return stepId === null || run.steps.some(
    (step) => step.id === stepId && step.status === "success",
  );
}

/** Called only while delivering the durable terminal publication, including replay. */
export function dismissSupersededWorkflowDeadLetters(args: {
  deadLetterQueue: DeadLetterQueueStore;
  runStore: WorkflowRunStore;
  successfulRun: WorkflowRunMetadata;
  log?: (message: string) => void;
}): string[] {
  const dismissed: string[] = [];
  const run = args.successfulRun;
  for (const item of args.deadLetterQueue.list({
    status: "open",
    type: "workflow-dispatch",
  })) {
    if (!isSupersedableWorkflowFailure(item)) continue;
    const workflow = deadLetterWorkflowName(item);
    if (run.workflow !== workflow) continue;
    if (!runSupersedesDeadLetter(item, args.runStore, run)) continue;
    const repair = isWorkflowMetadataAuthorityFailure(item)
      ? args.runStore.retainedMetadataAuthorityRepair(item.failure.reason)
      : null;
    args.deadLetterQueue.dismiss(
      item.id,
      repair === null
        ? `Superseded by successful run ${run.id}`
        : `Superseded by successful run ${run.id} after metadata authority repair ${repair.runId}`,
    );
    dismissed.push(item.id);
  }
  if (dismissed.length > 0) {
    args.log?.(
      `Dismissed ${dismissed.length} transient workflow dead-letter item(s) superseded by later success`,
    );
  }
  return dismissed;
}
