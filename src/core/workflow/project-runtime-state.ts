import { isEventSchemaReference } from "#core/events/event-bus-envelope-types.js";
import type { RunStateDatabase } from "./run-state-database.js";
import type {
  WorkflowAgentBackoffState,
  WorkflowBatchBufferState,
  WorkflowBatchBuffers,
  WorkflowBatchTrigger,
  WorkflowTrigger,
} from "./trigger-types.js";

export const AGENT_BACKOFF_STATE_KEY = "runtime/agent-backoff";
export const WORKFLOW_BATCHES_STATE_KEY = "runtime/workflow-batches";
export const DISPATCH_PAUSE_STATE_KEY = "runtime/dispatch-pause";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBackoff(value: unknown): value is WorkflowAgentBackoffState {
  return isObject(value) &&
    typeof value.runtimeId === "string" && value.runtimeId.length > 0 &&
    (value.kind === "rate_limit" || value.kind === "auth" ||
      value.kind === "provider" || value.kind === "runtime") &&
    Number.isSafeInteger(value.failureCount) && Number(value.failureCount) > 0 &&
    typeof value.until === "string" && value.until.length > 0 &&
    typeof value.updatedAt === "string" && value.updatedAt.length > 0 &&
    typeof value.reason === "string" && value.reason.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isBatchTrigger(value: unknown): value is WorkflowBatchTrigger {
  if (!isObject(value)) return false;
  return (value.maxCount !== undefined || value.maxAgeMs !== undefined ||
      value.idleTimeoutMs !== undefined) &&
    (value.maxCount === undefined || isPositiveInteger(value.maxCount)) &&
    (value.maxAgeMs === undefined || isPositiveInteger(value.maxAgeMs)) &&
    (value.idleTimeoutMs === undefined || isPositiveInteger(value.idleTimeoutMs)) &&
    Array.isArray(value.groupBy) &&
    value.groupBy.every((entry) => typeof entry === "string" && entry.length > 0) &&
    (value.flushEvent === undefined ||
      (typeof value.flushEvent === "string" && value.flushEvent.length > 0)) &&
    isPositiveInteger(value.maxBufferSize) &&
    (value.maxCount === undefined || value.maxCount <= value.maxBufferSize) &&
    (value.overflow === "drop-newest" || value.overflow === "flush-oldest");
}

function isRuntimeTrigger(value: unknown, event: string): value is WorkflowTrigger {
  return isObject(value) && value.event === event &&
    (value.schemaVersion === undefined || isPositiveInteger(value.schemaVersion)) &&
    value.filter === undefined && isBatchTrigger(value.batch) &&
    Number.isSafeInteger(value.cooldownMs) && Number(value.cooldownMs) >= 0;
}

function isBatchBuffer(value: unknown): value is WorkflowBatchBufferState {
  if (!isObject(value)) return false;
  const event = typeof value.sourceEventName === "string" ? value.sourceEventName : "";
  const declared = Number.isSafeInteger(value.triggerIndex) &&
    Number(value.triggerIndex) >= 0 && value.runtimeTrigger === undefined;
  const dynamic = value.triggerIndex === -1 && isRuntimeTrigger(value.runtimeTrigger, event);
  return typeof value.definitionName === "string" && value.definitionName.length > 0 &&
    (declared || dynamic) && event.length > 0 &&
    typeof value.scopeId === "string" && value.scopeId.length > 0 &&
    value.projectId === value.scopeId &&
    typeof value.groupingKey === "string" && value.groupingKey.length > 0 &&
    Array.isArray(value.groupValues) && value.groupValues.every((entry) =>
      isObject(entry) && typeof entry.field === "string" && entry.field.length > 0 &&
      typeof entry.value === "string") &&
    typeof value.firstEventAt === "string" && value.firstEventAt.length > 0 &&
    typeof value.lastEventAt === "string" && value.lastEventAt.length > 0 &&
    Array.isArray(value.inputEvents) && value.inputEvents.length > 0 &&
    value.inputEvents.every((entry) =>
      isObject(entry) && typeof entry.event === "string" && entry.event.length > 0 &&
      (entry.schemaRef === null || isEventSchemaReference(entry.schemaRef)) &&
      (entry.eventId === undefined || typeof entry.eventId === "string") &&
      typeof entry.receivedAt === "string" && entry.receivedAt.length > 0 &&
      isObject(entry.payload)) &&
    Number.isSafeInteger(value.droppedInputCount) && Number(value.droppedInputCount) >= 0;
}

export function decodeAgentBackoff(value: unknown): WorkflowAgentBackoffState | null {
  if (value === null) return null;
  if (!isBackoff(value)) throw new Error("Stored agent backoff is invalid");
  return value;
}

export function decodeWorkflowBatchBuffers(value: unknown): WorkflowBatchBuffers {
  if (value === null) return {};
  if (!isObject(value)) throw new Error("Stored workflow batch buffers are invalid");
  for (const [key, buffer] of Object.entries(value)) {
    if (!isBatchBuffer(buffer)) {
      throw new Error(`Stored workflow batch buffer "${key}" is invalid`);
    }
  }
  return value as WorkflowBatchBuffers;
}

/** Typed runtime-owned access to mutable project state in the run database. */
export class ProjectRuntimeStateStore {
  constructor(
    private readonly database: RunStateDatabase,
    private readonly projectId: string,
  ) {}

  getAgentBackoff(): WorkflowAgentBackoffState | null {
    return decodeAgentBackoff(
      this.database.readProjectStateValue(this.projectId, AGENT_BACKOFF_STATE_KEY).value,
    );
  }

  setAgentBackoff(value: WorkflowAgentBackoffState | null): void {
    this.set(AGENT_BACKOFF_STATE_KEY, value);
  }

  getDispatchPaused(): boolean {
    const value = this.database.readProjectStateValue(
      this.projectId,
      DISPATCH_PAUSE_STATE_KEY,
    ).value;
    if (value === null) return false;
    if (typeof value !== "boolean") {
      throw new Error("Stored workflow dispatch pause is invalid");
    }
    return value;
  }

  setDispatchPaused(paused: boolean): void {
    this.set(DISPATCH_PAUSE_STATE_KEY, paused);
  }

  getBatchBuffers(): WorkflowBatchBuffers {
    return decodeWorkflowBatchBuffers(
      this.database.readProjectStateValue(this.projectId, WORKFLOW_BATCHES_STATE_KEY).value,
    );
  }

  setBatchBuffers(value: WorkflowBatchBuffers): void {
    this.set(WORKFLOW_BATCHES_STATE_KEY, value);
  }

  private set(key: string, value: unknown): void {
    const current = this.database.readProjectStateValue(this.projectId, key);
    this.database.compareAndSetProjectStateValue({
      projectId: this.projectId,
      key,
      expectedRevision: current.revision,
      value,
      updatedAt: new Date().toISOString(),
    });
  }
}
