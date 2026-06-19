import type { BusEnvelope } from "#core/events/event-bus.js";
import type {
  WorkflowBatchBufferState,
  WorkflowBatchBuffers,
  WorkflowBatchFlushPayload,
  WorkflowBatchFlushReason,
  WorkflowBatchGroupValue,
  WorkflowBatchInputEventEnvelope,
  WorkflowBatchTrigger,
  WorkflowTrigger,
} from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

type EventPayload = BusEnvelope["payload"];
type EventPayloadValue = EventPayload[string];

export type WorkflowBatchTarget = {
  definition: WorkflowDefinition;
  trigger: WorkflowTrigger;
  triggerIndex: number;
};

export type WorkflowBatchGroupResolution =
  | { ok: true; groupingKey: string; groupValues: readonly WorkflowBatchGroupValue[] }
  | { ok: false; reason: string };

export type WorkflowBatchTimerMap = Map<string, ReturnType<typeof setTimeout>>;

export function clearWorkflowBatchTimer(timers: WorkflowBatchTimerMap, key: string): void {
  const timer = timers.get(key);
  if (timer) clearTimeout(timer);
  timers.delete(key);
}

export function clearWorkflowBatchTimers(timers: WorkflowBatchTimerMap): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}

export function scheduleWorkflowBatchTimer(args: {
  timers: WorkflowBatchTimerMap;
  key: string;
  buffer: WorkflowBatchBufferState;
  batch: WorkflowBatchTrigger;
  onDue: (reason: Extract<WorkflowBatchFlushReason, "max-age" | "idle-timeout">) => void;
}): void {
  clearWorkflowBatchTimer(args.timers, args.key);
  const due = nextWorkflowBatchTimerDue(args.buffer, args.batch);
  if (!due) return;
  const timer = setTimeout(() => args.onDue(due.reason), Math.max(0, due.atMs - Date.now()));
  timer.unref();
  args.timers.set(args.key, timer);
}

export function createWorkflowBatchInputEvent(
  envelope: BusEnvelope,
  receivedAt: string,
): WorkflowBatchInputEventEnvelope {
  return {
    event: envelope.type,
    schemaRef: envelope.schemaRef,
    ...(envelope.eventId !== undefined ? { eventId: envelope.eventId } : {}),
    receivedAt,
    payload: { ...envelope.payload },
  };
}

export function createWorkflowBatchFlushPayload(args: {
  buffer: WorkflowBatchBufferState;
  batch: WorkflowBatchTrigger;
  reason: WorkflowBatchFlushReason;
  flushedAt: string;
}): WorkflowBatchFlushPayload {
  return {
    scopeId: args.buffer.scopeId,
    projectId: args.buffer.projectId,
    sourceEventName: args.buffer.sourceEventName,
    groupingKey: args.buffer.groupingKey,
    reason: args.reason,
    count: args.buffer.inputEvents.length,
    window: {
      firstEventAt: args.buffer.firstEventAt,
      lastEventAt: args.buffer.lastEventAt,
      flushedAt: args.flushedAt,
    },
    inputEvents: args.buffer.inputEvents,
    batch: {
      workflow: args.buffer.definitionName,
      triggerIndex: args.buffer.triggerIndex,
      maxBufferSize: args.batch.maxBufferSize,
      overflow: args.batch.overflow,
      droppedInputCount: args.buffer.droppedInputCount,
    },
  };
}

export function matchingWorkflowBatchManualFlushKeys(args: {
  definitions: readonly WorkflowDefinition[];
  buffers: WorkflowBatchBuffers;
  envelope: BusEnvelope;
}): string[] {
  const requestedWorkflow =
    typeof args.envelope.payload.workflow === "string" ? args.envelope.payload.workflow : undefined;
  const requestedSource =
    typeof args.envelope.payload.sourceEventName === "string"
      ? args.envelope.payload.sourceEventName
      : undefined;
  const requestedGroupingKey =
    typeof args.envelope.payload.groupingKey === "string"
      ? args.envelope.payload.groupingKey
      : undefined;
  const requestedScope = explicitWorkflowBatchScope(args.envelope.payload);
  const keys: string[] = [];
  for (const definition of args.definitions) {
    if (!definition.enabled) continue;
    if (requestedWorkflow && requestedWorkflow !== definition.name) continue;
    collectManualFlushKeysForDefinition({
      definition,
      buffers: args.buffers,
      envelope: args.envelope,
      requestedSource,
      requestedGroupingKey,
      requestedScope,
      keys,
    });
  }
  return keys;
}

export function findWorkflowBatchTarget(
  definitions: readonly WorkflowDefinition[],
  buffer: WorkflowBatchBufferState,
): WorkflowBatchTarget | null {
  const definition = definitions.find(
    (candidate) => candidate.name === buffer.definitionName,
  );
  if (!definition?.enabled) return null;
  if (buffer.triggerIndex === -1) {
    const trigger = buffer.runtimeTrigger;
    if (!trigger?.batch) return null;
    if (trigger.event !== buffer.sourceEventName) return null;
    return { definition, trigger, triggerIndex: buffer.triggerIndex };
  }
  const trigger = definition.triggers[buffer.triggerIndex];
  if (!trigger?.batch) return null;
  if (trigger.event !== buffer.sourceEventName) return null;
  return { definition, trigger, triggerIndex: buffer.triggerIndex };
}

export function createWorkflowBatchBuffer(
  target: WorkflowBatchTarget,
  scopeId: string,
  group: Extract<WorkflowBatchGroupResolution, { ok: true }>,
  inputEvent: WorkflowBatchInputEventEnvelope,
): WorkflowBatchBufferState {
  return {
    definitionName: target.definition.name,
    triggerIndex: target.triggerIndex,
    sourceEventName: inputEvent.event,
    ...(target.triggerIndex === -1 ? { runtimeTrigger: target.trigger } : {}),
    scopeId,
    projectId: scopeId,
    groupingKey: group.groupingKey,
    groupValues: group.groupValues,
    firstEventAt: inputEvent.receivedAt,
    lastEventAt: inputEvent.receivedAt,
    inputEvents: [inputEvent],
    droppedInputCount: 0,
  };
}

export function nextWorkflowBatchTimerDue(
  buffer: WorkflowBatchBufferState,
  batch: WorkflowBatchTrigger,
): { atMs: number; reason: Extract<WorkflowBatchFlushReason, "max-age" | "idle-timeout"> } | null {
  const due: { atMs: number; reason: Extract<WorkflowBatchFlushReason, "max-age" | "idle-timeout"> }[] = [];
  if (batch.maxAgeMs !== undefined) {
    due.push({
      atMs: new Date(buffer.firstEventAt).getTime() + batch.maxAgeMs,
      reason: "max-age",
    });
  }
  if (batch.idleTimeoutMs !== undefined) {
    due.push({
      atMs: new Date(buffer.lastEventAt).getTime() + batch.idleTimeoutMs,
      reason: "idle-timeout",
    });
  }
  if (due.length === 0) return null;
  return due.sort((a, b) => a.atMs - b.atMs)[0]!;
}

export function resolveWorkflowBatchGroup(
  batch: WorkflowBatchTrigger,
  payload: EventPayload,
): WorkflowBatchGroupResolution {
  if (batch.groupBy.length === 0) {
    return { ok: true, groupingKey: "default", groupValues: [] };
  }
  const groupValues: WorkflowBatchGroupValue[] = [];
  for (const field of batch.groupBy) {
    const resolved = resolveGroupField(field, payloadPathValue(payload, field));
    if (!resolved.ok) return resolved;
    groupValues.push({ field, value: resolved.value });
  }
  return {
    ok: true,
    groupingKey: groupValues.map((entry) => `${entry.field}=${entry.value}`).join("|"),
    groupValues,
  };
}

export function explicitWorkflowBatchScope(payload: EventPayload): string | undefined {
  const scopeId =
    typeof payload.scopeId === "string" && payload.scopeId.length > 0
      ? payload.scopeId
      : undefined;
  const projectId =
    typeof payload.projectId === "string" && payload.projectId.length > 0
      ? payload.projectId
      : undefined;
  return scopeId ?? projectId;
}

export function workflowBatchBufferKey(
  definitionName: string,
  triggerIndex: number,
  scopeId: string,
  groupingKey: string,
): string {
  return [definitionName, String(triggerIndex), scopeId, groupingKey].join("\u0000");
}

function collectManualFlushKeysForDefinition(args: {
  definition: WorkflowDefinition;
  buffers: WorkflowBatchBuffers;
  envelope: BusEnvelope;
  requestedSource: string | undefined;
  requestedGroupingKey: string | undefined;
  requestedScope: string | undefined;
  keys: string[];
}): void {
  for (let triggerIndex = 0; triggerIndex < args.definition.triggers.length; triggerIndex++) {
    const trigger = args.definition.triggers[triggerIndex]!;
    const flushEvent = trigger.batch?.flushEvent;
    if (!flushEvent || flushEvent !== args.envelope.type) continue;
    for (const [key, buffer] of Object.entries(args.buffers)) {
      if (buffer.definitionName !== args.definition.name) continue;
      if (buffer.triggerIndex !== triggerIndex) continue;
      if (args.requestedSource && args.requestedSource !== buffer.sourceEventName) continue;
      if (args.requestedGroupingKey && args.requestedGroupingKey !== buffer.groupingKey) continue;
      if (args.requestedScope && args.requestedScope !== buffer.scopeId) continue;
      args.keys.push(key);
    }
  }
}

function resolveGroupField(
  field: string,
  value: EventPayloadValue,
): { ok: true; value: string } | { ok: false; reason: string } {
  if (value === undefined) return { ok: true, value: "<missing>" };
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return { ok: true, value: String(value) };
  }
  if (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === "string" ||
        typeof item === "number" ||
        typeof item === "boolean",
    )
  ) {
    return { ok: true, value: JSON.stringify(value) };
  }
  return { ok: false, reason: `batch.groupBy field "${field}" must resolve to a scalar or scalar array` };
}

function payloadPathValue(payload: EventPayload, path: string): EventPayloadValue {
  const segments = path.split(".");
  let current: EventPayload | EventPayloadValue = payload;
  for (const segment of segments) {
    if (!isPayloadObject(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function isPayloadObject(
  value: EventPayload | EventPayloadValue,
): value is EventPayload {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
