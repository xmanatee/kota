import { isEventSchemaReference } from "#core/events/event-bus-envelope-types.js";
import { JsonFileError } from "#core/util/json-file.js";
import type {
  WorkflowCompletion,
  WorkflowRunMetadata,
  WorkflowRunRef,
  WorkflowRunStatus,
  WorkflowRuntimeState,
  WorkflowStepSkipReason,
} from "./run-types.js";
import type {
  WorkflowAgentBackoffState,
  WorkflowBatchBufferState,
  WorkflowBatchTrigger,
  WorkflowRunTrigger,
  WorkflowTrigger,
} from "./trigger-types.js";

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
    typeof value.runtimeId === "string" &&
    value.runtimeId.trim().length > 0 &&
    (
      value.kind === "rate_limit" ||
      value.kind === "auth" ||
      value.kind === "provider" ||
      value.kind === "runtime"
    ) &&
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
  return (
    isPlainObject(value) &&
    typeof value.event === "string" &&
    (value.schemaRef === null || isEventSchemaReference(value.schemaRef)) &&
    (value.eventId === undefined || typeof value.eventId === "string") &&
    isPlainObject(value.payload)
  );
}

function isWorkflowBatchGroupValue(value: Parameters<typeof isPlainObject>[0]): boolean {
  return (
    isPlainObject(value) &&
    typeof value.field === "string" &&
    value.field.trim().length > 0 &&
    typeof value.value === "string"
  );
}

function isWorkflowBatchInputEventEnvelope(value: Parameters<typeof isPlainObject>[0]): boolean {
  return (
    isPlainObject(value) &&
    typeof value.event === "string" &&
    value.event.trim().length > 0 &&
    (value.schemaRef === null || isEventSchemaReference(value.schemaRef)) &&
    (value.eventId === undefined || typeof value.eventId === "string") &&
    typeof value.receivedAt === "string" &&
    value.receivedAt.trim().length > 0 &&
    isPlainObject(value.payload)
  );
}

function isWorkflowBatchTrigger(value: Parameters<typeof isPlainObject>[0]): value is WorkflowBatchTrigger {
  if (!isPlainObject(value)) return false;
  const hasFlushCondition =
    value.maxCount !== undefined ||
    value.maxAgeMs !== undefined ||
    value.idleTimeoutMs !== undefined;
  const maxCount =
    typeof value.maxCount === "number" && Number.isInteger(value.maxCount)
      ? value.maxCount
      : undefined;
  const maxBufferSize =
    typeof value.maxBufferSize === "number" && Number.isInteger(value.maxBufferSize)
      ? value.maxBufferSize
      : undefined;
  return (
    hasFlushCondition &&
    (value.maxCount === undefined ||
      (maxCount !== undefined && maxCount > 0)) &&
    (value.maxAgeMs === undefined ||
      (typeof value.maxAgeMs === "number" &&
        Number.isInteger(value.maxAgeMs) &&
        value.maxAgeMs > 0)) &&
    (value.idleTimeoutMs === undefined ||
      (typeof value.idleTimeoutMs === "number" &&
        Number.isInteger(value.idleTimeoutMs) &&
        value.idleTimeoutMs > 0)) &&
    Array.isArray(value.groupBy) &&
    value.groupBy.every((item) => typeof item === "string" && item.trim().length > 0) &&
    (value.flushEvent === undefined ||
      (typeof value.flushEvent === "string" && value.flushEvent.trim().length > 0)) &&
    maxBufferSize !== undefined &&
    maxBufferSize > 0 &&
    (maxCount === undefined || maxCount <= maxBufferSize) &&
    (value.overflow === "drop-newest" || value.overflow === "flush-oldest")
  );
}

function isWorkflowRuntimeBufferTrigger(
  value: Parameters<typeof isPlainObject>[0],
): value is WorkflowTrigger {
  return (
    isPlainObject(value) &&
    typeof value.event === "string" &&
    value.event.trim().length > 0 &&
    (value.schemaVersion === undefined ||
      (typeof value.schemaVersion === "number" &&
        Number.isInteger(value.schemaVersion) &&
        value.schemaVersion >= 1)) &&
    value.filter === undefined &&
    isWorkflowBatchTrigger(value.batch) &&
    typeof value.cooldownMs === "number" &&
    Number.isInteger(value.cooldownMs) &&
    value.cooldownMs >= 0
  );
}

function isWorkflowBatchBufferState(
  value: Parameters<typeof isPlainObject>[0],
): value is WorkflowBatchBufferState {
  if (!isPlainObject(value)) return false;
  const sourceEventName =
    typeof value.sourceEventName === "string" ? value.sourceEventName : "";
  const runtimeTrigger = value.runtimeTrigger;
  const hasDeclaredTrigger =
    typeof value.triggerIndex === "number" &&
    Number.isInteger(value.triggerIndex) &&
    value.triggerIndex >= 0 &&
    runtimeTrigger === undefined;
  const hasRuntimeTrigger =
    value.triggerIndex === -1 &&
    isWorkflowRuntimeBufferTrigger(runtimeTrigger) &&
    runtimeTrigger.event === sourceEventName;
  return (
    typeof value.definitionName === "string" &&
    value.definitionName.trim().length > 0 &&
    (hasDeclaredTrigger || hasRuntimeTrigger) &&
    typeof value.sourceEventName === "string" &&
    value.sourceEventName.trim().length > 0 &&
    typeof value.scopeId === "string" &&
    value.scopeId.trim().length > 0 &&
    typeof value.projectId === "string" &&
    value.projectId === value.scopeId &&
    typeof value.groupingKey === "string" &&
    value.groupingKey.trim().length > 0 &&
    Array.isArray(value.groupValues) &&
    value.groupValues.every(isWorkflowBatchGroupValue) &&
    typeof value.firstEventAt === "string" &&
    value.firstEventAt.trim().length > 0 &&
    typeof value.lastEventAt === "string" &&
    value.lastEventAt.trim().length > 0 &&
    Array.isArray(value.inputEvents) &&
    value.inputEvents.length > 0 &&
    value.inputEvents.every(isWorkflowBatchInputEventEnvelope) &&
    typeof value.droppedInputCount === "number" &&
    Number.isInteger(value.droppedInputCount) &&
    value.droppedInputCount >= 0
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
  for (const field of ["totalCostUsd", "totalInputTokens", "totalOutputTokens"]) {
    const metric = value[field];
    if (
      metric !== undefined &&
      (typeof metric !== "number" || !Number.isFinite(metric) || metric < 0)
    ) {
      fail(path, `workflow state has invalid ${field}`);
    }
  }
  if (!isPlainObject(value.workflows)) fail(path, "workflow state has invalid workflows");
  if (value.agentBackoff !== undefined && !isWorkflowAgentBackoffState(value.agentBackoff)) {
    fail(path, "workflow state has invalid agentBackoff");
  }
  if (value.batchBuffers !== undefined) {
    if (!isPlainObject(value.batchBuffers)) {
      fail(path, "workflow state has invalid batchBuffers");
    }
    for (const [key, entry] of Object.entries(value.batchBuffers)) {
      if (!isWorkflowBatchBufferState(entry)) {
        fail(path, `workflow state batch buffer "${key}" is invalid`);
      }
    }
  }
  for (const [workflowName, entry] of Object.entries(value.workflows)) {
    if (!isPlainObject(entry)) {
      fail(path, `workflow state entry "${workflowName}" is invalid`);
    }
    if (
      "lastRunId" in entry ||
      "lastStartedAt" in entry ||
      "lastCompletedAt" in entry ||
      "lastStatus" in entry
    ) {
      fail(path, `workflow state entry "${workflowName}" uses legacy fields`);
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
