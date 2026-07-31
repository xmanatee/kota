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

function isTransientWorkflowFailure(item: DeadLetterItem): boolean {
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
  );
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
): boolean {
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

function supersedingRun(
  item: DeadLetterItem,
  runStore: WorkflowRunStore,
  candidates: WorkflowRunMetadata[],
): WorkflowRunMetadata | null {
  const failedAtMs = Date.parse(item.failure.lastFailedAt);
  if (!Number.isFinite(failedAtMs)) return null;
  const stepId = failedStepId(item, runStore);
  return candidates.find((run) => {
    if (run.status !== "success" && run.status !== "completed-with-warnings") {
      return false;
    }
    const completedAtMs = Date.parse(run.completedAt ?? run.startedAt);
    if (!Number.isFinite(completedAtMs) || completedAtMs <= failedAtMs) {
      return false;
    }
    if (!runContinuesDeadLetter(item, run)) return false;
    return stepId === null || run.steps.some(
      (step) => step.id === stepId && step.status === "success",
    );
  }) ?? null;
}

export function dismissSupersededWorkflowDeadLetters(args: {
  deadLetterQueue: DeadLetterQueueStore;
  runStore: WorkflowRunStore;
  successfulRun?: WorkflowRunMetadata;
  log?: (message: string) => void;
}): string[] {
  const dismissed: string[] = [];
  const runsByWorkflow = new Map<string, WorkflowRunMetadata[]>();
  for (const item of args.deadLetterQueue.list({
    status: "open",
    type: "workflow-dispatch",
  })) {
    if (!isTransientWorkflowFailure(item)) continue;
    const workflow = deadLetterWorkflowName(item);
    if (!workflow) continue;
    if (
      args.successfulRun !== undefined &&
      args.successfulRun.workflow !== workflow
    ) {
      continue;
    }
    let candidates: WorkflowRunMetadata[];
    if (args.successfulRun !== undefined) {
      candidates = [args.successfulRun];
    } else {
      candidates = runsByWorkflow.get(workflow) ??
        args.runStore.listRuns({
          workflow,
          limit: Number.MAX_SAFE_INTEGER,
        });
      runsByWorkflow.set(workflow, candidates);
    }
    const run = supersedingRun(item, args.runStore, candidates);
    if (!run) continue;
    args.deadLetterQueue.dismiss(
      item.id,
      `Superseded by successful run ${run.id}`,
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
