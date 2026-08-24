import { isEventSchemaReference } from "#core/events/event-bus-envelope-types.js";
import type {
  WorkflowBatchBufferState,
  WorkflowBatchTrigger,
  WorkflowTrigger,
} from "./trigger-types.js";

type PlainObjectPredicate = typeof import("./run-store-state-schema.js").isPlainObject;
type Candidate = Parameters<PlainObjectPredicate>[0];

function isWorkflowBatchGroupValue(
  value: Candidate,
  isPlainObject: PlainObjectPredicate,
): boolean {
  return (
    isPlainObject(value) &&
    typeof value.field === "string" &&
    value.field.trim().length > 0 &&
    typeof value.value === "string"
  );
}

function isWorkflowBatchInputEventEnvelope(
  value: Candidate,
  isPlainObject: PlainObjectPredicate,
): boolean {
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

function isWorkflowBatchTrigger(
  value: Candidate,
  isPlainObject: PlainObjectPredicate,
): value is WorkflowBatchTrigger {
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
    value.groupBy.every((item) =>
      typeof item === "string" && item.trim().length > 0
    ) &&
    (value.flushEvent === undefined ||
      (typeof value.flushEvent === "string" && value.flushEvent.trim().length > 0)) &&
    maxBufferSize !== undefined &&
    maxBufferSize > 0 &&
    (maxCount === undefined || maxCount <= maxBufferSize) &&
    (value.overflow === "drop-newest" || value.overflow === "flush-oldest")
  );
}

function isWorkflowRuntimeBufferTrigger(
  value: Candidate,
  isPlainObject: PlainObjectPredicate,
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
    isWorkflowBatchTrigger(value.batch, isPlainObject) &&
    typeof value.cooldownMs === "number" &&
    Number.isInteger(value.cooldownMs) &&
    value.cooldownMs >= 0
  );
}

export function isWorkflowBatchBufferState(
  value: Candidate,
  isPlainObject: PlainObjectPredicate,
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
    isWorkflowRuntimeBufferTrigger(runtimeTrigger, isPlainObject) &&
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
    value.groupValues.every((item) =>
      isWorkflowBatchGroupValue(item, isPlainObject)
    ) &&
    typeof value.firstEventAt === "string" &&
    value.firstEventAt.trim().length > 0 &&
    typeof value.lastEventAt === "string" &&
    value.lastEventAt.trim().length > 0 &&
    Array.isArray(value.inputEvents) &&
    value.inputEvents.length > 0 &&
    value.inputEvents.every((item) =>
      isWorkflowBatchInputEventEnvelope(item, isPlainObject)
    ) &&
    typeof value.droppedInputCount === "number" &&
    Number.isInteger(value.droppedInputCount) &&
    value.droppedInputCount >= 0
  );
}
