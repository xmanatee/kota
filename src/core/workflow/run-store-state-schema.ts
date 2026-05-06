import { isAutonomyMode } from "#core/tools/autonomy-mode.js";
import { JsonFileError } from "#core/util/json-file.js";
import type {
  WorkflowCompletion,
  WorkflowQueuedRun,
  WorkflowRecoveryState,
  WorkflowRunMetadata,
  WorkflowRunRef,
  WorkflowRunStatus,
  WorkflowRuntimeState,
  WorkflowStepSkipReason,
} from "./run-types.js";
import type { WorkflowAgentBackoffState, WorkflowRunTrigger } from "./types.js";

function fail(path: string, message: string): never {
  throw new JsonFileError(path, "parse", message);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isWorkflowRunStatus(value: unknown): value is WorkflowRunStatus {
  return (
    value === "success" ||
    value === "failed" ||
    value === "interrupted" ||
    value === "completed-with-warnings"
  );
}

function isIsoString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isWorkflowRunRef(value: unknown): value is WorkflowRunRef {
  return isPlainObject(value) && isIsoString(value.runId) && isIsoString(value.startedAt);
}

function isWorkflowCompletion(value: unknown): value is WorkflowCompletion {
  return (
    isPlainObject(value) &&
    isIsoString(value.runId) &&
    isIsoString(value.startedAt) &&
    isIsoString(value.completedAt) &&
    isWorkflowRunStatus(value.status)
  );
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isWorkflowCompletedQueuedPayload(value: Record<string, unknown>): boolean {
  return (
    typeof value.workflow === "string" &&
    value.workflow.trim().length > 0 &&
    typeof value.runId === "string" &&
    value.runId.trim().length > 0 &&
    isWorkflowRunStatus(value.status) &&
    typeof value.triggerEvent === "string" &&
    value.triggerEvent.trim().length > 0 &&
    typeof value.durationMs === "number" &&
    Number.isFinite(value.durationMs) &&
    typeof value.definitionPath === "string" &&
    value.definitionPath.trim().length > 0 &&
    typeof value.runDir === "string" &&
    value.runDir.trim().length > 0 &&
    isStringArray(value.tags) &&
    (
      value.failureKind === undefined ||
      value.failureKind === "rate_limit" ||
      value.failureKind === "auth" ||
      value.failureKind === "provider"
    ) &&
    (value.autonomyMode === undefined || isAutonomyMode(value.autonomyMode))
  );
}

function isWorkflowStepSkipReason(value: unknown): value is WorkflowStepSkipReason {
  return (
    isPlainObject(value) &&
    (
      value.kind === "when-predicate" ||
      value.kind === "branch-arm-not-taken" ||
      value.kind === "parent-skipped" ||
      value.kind === "foreach-empty"
    ) &&
    (value.label === undefined || typeof value.label === "string")
  );
}

function assertWorkflowStepResult(path: string, value: unknown): void {
  if (
    !isPlainObject(value) ||
    typeof value.id !== "string" ||
    typeof value.type !== "string" ||
    typeof value.startedAt !== "string" ||
    typeof value.completedAt !== "string" ||
    typeof value.durationMs !== "number"
  ) {
    fail(path, "workflow run metadata has invalid step result");
  }
  if (value.status !== "success" && value.status !== "failed" && value.status !== "skipped") {
    fail(path, "workflow run metadata has invalid step status");
  }
  if (value.status === "skipped") {
    if (!isWorkflowStepSkipReason(value.skipReason)) {
      fail(path, "skipped workflow step is missing a valid skipReason");
    }
    return;
  }
  if (value.skipReason !== undefined) {
    fail(path, "non-skipped workflow step must not include skipReason");
  }
}

function isWorkflowAgentBackoffState(value: unknown): value is WorkflowAgentBackoffState {
  return (
    isPlainObject(value) &&
    (value.kind === "rate_limit" || value.kind === "auth" || value.kind === "provider") &&
    typeof value.failureCount === "number" &&
    Number.isInteger(value.failureCount) &&
    value.failureCount > 0 &&
    typeof value.until === "string" &&
    value.until.trim().length > 0 &&
    typeof value.updatedAt === "string" &&
    value.updatedAt.trim().length > 0 &&
    typeof value.reason === "string" &&
    value.reason.trim().length > 0
  );
}

function isWorkflowRunTrigger(value: unknown): value is WorkflowRunTrigger {
  return isPlainObject(value) && typeof value.event === "string" && isPlainObject(value.payload);
}

function isQueuedRunTrigger(value: unknown): value is WorkflowRunTrigger {
  if (!isWorkflowRunTrigger(value)) return false;
  if (value.event === "workflow.completed") {
    return isWorkflowCompletedQueuedPayload(value.payload);
  }
  return true;
}

function isQueuedRun(value: unknown): value is WorkflowQueuedRun {
  return (
    isPlainObject(value) &&
    typeof value.workflowName === "string" &&
    isQueuedRunTrigger(value.trigger) &&
    Number.isFinite(value.enqueuedAtMs) &&
    Number.isFinite(value.notBeforeMs)
  );
}

function isRetryAttempt(value: unknown): boolean {
  return (
    isPlainObject(value) &&
    typeof value.workflow === "string" &&
    typeof value.runId === "string" &&
    typeof value.attemptedAt === "string"
  );
}

function isWorkflowRecoveryState(value: unknown): value is WorkflowRecoveryState {
  return (
    isPlainObject(value) &&
    typeof value.sourceRunId === "string" &&
    value.sourceRunId.trim().length > 0 &&
    typeof value.sourceWorkflow === "string" &&
    value.sourceWorkflow.trim().length > 0 &&
    typeof value.worktreeFingerprint === "string" &&
    typeof value.worktreeSummary === "string" &&
    typeof value.attempts === "number" &&
    Number.isInteger(value.attempts) &&
    value.attempts >= 0 &&
    Array.isArray(value.retryAttemptedBy) &&
    value.retryAttemptedBy.every(isRetryAttempt) &&
    typeof value.updatedAt === "string" &&
    value.updatedAt.trim().length > 0
  );
}

export function assertWorkflowRuntimeState(
  path: string,
  value: unknown,
): asserts value is WorkflowRuntimeState {
  if (!isPlainObject(value)) fail(path, "invalid workflow state shape");
  const completedRuns = value.completedRuns;
  if (
    typeof completedRuns !== "number" ||
    !Number.isInteger(completedRuns) ||
    completedRuns < 0
  ) {
    fail(path, "workflow state missing completedRuns");
  }
  if (!Array.isArray(value.pendingRuns) || value.pendingRuns.some((item) => !isQueuedRun(item))) {
    fail(path, "workflow state has invalid pendingRuns");
  }
  if (!isPlainObject(value.workflows)) fail(path, "workflow state has invalid workflows");
  if (value.agentBackoff !== undefined && !isWorkflowAgentBackoffState(value.agentBackoff)) {
    fail(path, "workflow state has invalid agentBackoff");
  }
  if (value.recovery !== undefined && !isWorkflowRecoveryState(value.recovery)) {
    fail(path, "workflow state has invalid recovery");
  }
  for (const [workflowName, entry] of Object.entries(value.workflows)) {
    if (!isPlainObject(entry)) {
      fail(path, `workflow state entry "${workflowName}" is invalid`);
    }
    if (entry.lastStarted !== undefined && !isWorkflowRunRef(entry.lastStarted)) {
      fail(path, `workflow state entry "${workflowName}" has invalid lastStarted`);
    }
    if (entry.lastCompletion !== undefined && !isWorkflowCompletion(entry.lastCompletion)) {
      fail(path, `workflow state entry "${workflowName}" has invalid lastCompletion`);
    }
    if (
      entry.nextScheduledAt !== undefined &&
      (typeof entry.nextScheduledAt !== "string" || !entry.nextScheduledAt.trim())
    ) {
      fail(path, `workflow state entry "${workflowName}" has invalid nextScheduledAt`);
    }
  }
  if (value.activeRuns !== undefined) {
    if (!Array.isArray(value.activeRuns)) {
      fail(path, "workflow state has invalid activeRuns");
    }
    for (const entry of value.activeRuns) {
      if (
        !isPlainObject(entry) ||
        typeof entry.runId !== "string" ||
        typeof entry.workflow !== "string" ||
        typeof entry.startedAt !== "string"
      ) {
        fail(path, "workflow state has invalid activeRuns entry");
      }
    }
  }
}

export function assertWorkflowRunMetadata(
  path: string,
  value: unknown,
): asserts value is WorkflowRunMetadata {
  if (!isPlainObject(value)) fail(path, "invalid workflow run metadata shape");
  if (
    typeof value.id !== "string" ||
    typeof value.workflow !== "string" ||
    typeof value.definitionPath !== "string" ||
    !isWorkflowRunTrigger(value.trigger) ||
    typeof value.startedAt !== "string" ||
    typeof value.runDir !== "string" ||
    !Array.isArray(value.steps)
  ) {
    fail(path, "workflow run metadata is incomplete");
  }
  if (value.status !== "running" && !isWorkflowRunStatus(value.status)) {
    fail(path, "workflow run metadata has invalid status");
  }
  for (const step of value.steps) {
    assertWorkflowStepResult(path, step);
  }
}
