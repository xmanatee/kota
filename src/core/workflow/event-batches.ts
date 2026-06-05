import type { BusEnvelope } from "#core/events/event-bus.js";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { matchesFilter } from "./run-executor-utils.js";
import type { WorkflowRunStore } from "./run-store.js";
import {
  WORKFLOW_BATCH_FLUSH_EVENT,
  type WorkflowBatchBufferState,
  type WorkflowBatchBuffers,
  type WorkflowBatchFlushPayload,
  type WorkflowBatchFlushReason,
  type WorkflowBatchGroupValue,
  type WorkflowBatchInputEventEnvelope,
  type WorkflowBatchTrigger,
  type WorkflowRunTrigger,
  type WorkflowTrigger,
} from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

type EventPayload = BusEnvelope["payload"];
type EventPayloadValue = EventPayload[string];

type EnqueueRun = (
  definition: WorkflowDefinition,
  trigger: WorkflowTrigger,
  runTrigger: WorkflowRunTrigger,
) => void;

type BatchTarget = {
  definition: WorkflowDefinition;
  trigger: WorkflowTrigger;
  triggerIndex: number;
};

type GroupResolution =
  | { ok: true; groupingKey: string; groupValues: readonly WorkflowBatchGroupValue[] }
  | { ok: false; reason: string };

type TimerDue = {
  atMs: number;
  reason: Extract<WorkflowBatchFlushReason, "max-age" | "idle-timeout">;
};

export class WorkflowEventBatchManager {
  private definitions: WorkflowDefinition[] = [];
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly store: WorkflowRunStore,
    private readonly isStopping: () => boolean,
    private readonly enqueueRun: EnqueueRun,
    private readonly maybeStartNext: () => void,
    private readonly getProjectBus: () => ProjectScopedEventBus,
    private readonly log: (message: string) => void,
  ) {}

  setup(definitions: WorkflowDefinition[]): void {
    this.definitions = definitions;
    this.clearTimers();

    const current = this.store.getBatchBuffers();
    const retained: WorkflowBatchBuffers = {};
    for (const [key, buffer] of Object.entries(current)) {
      const target = this.findTargetForBuffer(buffer);
      if (!target) continue;
      retained[key] = buffer;
    }
    if (Object.keys(retained).length !== Object.keys(current).length) {
      this.store.setBatchBuffers(retained);
    }
    for (const [key, buffer] of Object.entries(retained)) {
      const target = this.findTargetForBuffer(buffer);
      if (target) this.scheduleBuffer(key, buffer, target.trigger.batch!);
    }
  }

  clearAll(): void {
    this.clearTimers();
    this.definitions = [];
  }

  handleEvent(envelope: BusEnvelope): void {
    if (this.isStopping()) return;
    let flushed = this.flushManualMatches(envelope);

    for (const definition of this.definitions) {
      if (!definition.enabled) continue;
      for (let triggerIndex = 0; triggerIndex < definition.triggers.length; triggerIndex++) {
        const trigger = definition.triggers[triggerIndex]!;
        if (!trigger.batch) continue;
        if (trigger.event !== envelope.type) continue;
        if (!matchesFilter(trigger.filter, envelope.payload)) continue;
        flushed = this.addEventToBuffer(definition, trigger, triggerIndex, envelope) || flushed;
      }
    }

    if (flushed) this.maybeStartNext();
  }

  private flushManualMatches(envelope: BusEnvelope): boolean {
    let flushed = false;
    const requestedWorkflow =
      typeof envelope.payload.workflow === "string" ? envelope.payload.workflow : undefined;
    const requestedSource =
      typeof envelope.payload.sourceEventName === "string"
        ? envelope.payload.sourceEventName
        : undefined;
    const requestedGroupingKey =
      typeof envelope.payload.groupingKey === "string"
        ? envelope.payload.groupingKey
        : undefined;
    const requestedScope = explicitScope(envelope.payload);

    for (const definition of this.definitions) {
      if (!definition.enabled) continue;
      if (requestedWorkflow && requestedWorkflow !== definition.name) continue;
      for (let triggerIndex = 0; triggerIndex < definition.triggers.length; triggerIndex++) {
        const trigger = definition.triggers[triggerIndex]!;
        const flushEvent = trigger.batch?.flushEvent;
        if (!flushEvent || flushEvent !== envelope.type) continue;
        const buffers = this.store.getBatchBuffers();
        for (const [key, buffer] of Object.entries(buffers)) {
          if (buffer.definitionName !== definition.name) continue;
          if (buffer.triggerIndex !== triggerIndex) continue;
          if (requestedSource && requestedSource !== buffer.sourceEventName) continue;
          if (requestedGroupingKey && requestedGroupingKey !== buffer.groupingKey) continue;
          if (requestedScope && requestedScope !== buffer.scopeId) continue;
          flushed = this.flushBuffer(key, "manual") || flushed;
        }
      }
    }
    return flushed;
  }

  private addEventToBuffer(
    definition: WorkflowDefinition,
    trigger: WorkflowTrigger,
    triggerIndex: number,
    envelope: BusEnvelope,
  ): boolean {
    const batch = trigger.batch!;
    const scopeId = explicitScope(envelope.payload) ?? this.getProjectBus().getScopeId();
    const group = resolveGroup(batch, envelope.payload);
    if (!group.ok) {
      this.log(
        `Skipped workflow batch input for "${definition.name}" from event "${envelope.type}": ${group.reason}`,
      );
      return false;
    }

    const key = bufferKey(definition.name, triggerIndex, scopeId, group.groupingKey);
    const receivedAt = new Date().toISOString();
    const inputEvent: WorkflowBatchInputEventEnvelope = {
      event: envelope.type,
      schemaRef: envelope.schemaRef,
      ...(envelope.eventId !== undefined ? { eventId: envelope.eventId } : {}),
      receivedAt,
      payload: { ...envelope.payload },
    };
    const buffers = this.store.getBatchBuffers();
    const existing = buffers[key];

    if (existing && existing.inputEvents.length >= batch.maxBufferSize) {
      if (batch.overflow === "drop-newest") {
        buffers[key] = {
          ...existing,
          droppedInputCount: existing.droppedInputCount + 1,
        };
        this.store.setBatchBuffers(buffers);
        return false;
      }

      const flushed = this.flushBuffer(key, "overflow");
      const replacement = createBuffer(definition, triggerIndex, scopeId, group, inputEvent);
      this.storeBuffer(key, replacement);
      if (batch.maxCount !== undefined && replacement.inputEvents.length >= batch.maxCount) {
        return this.flushBuffer(key, "count") || flushed;
      }
      this.scheduleBuffer(key, replacement, batch);
      return flushed;
    }

    const nextBuffer = existing
      ? {
          ...existing,
          lastEventAt: receivedAt,
          inputEvents: [...existing.inputEvents, inputEvent],
        }
      : createBuffer(definition, triggerIndex, scopeId, group, inputEvent);

    this.storeBuffer(key, nextBuffer);

    if (batch.maxCount !== undefined && nextBuffer.inputEvents.length >= batch.maxCount) {
      return this.flushBuffer(key, "count");
    }
    this.scheduleBuffer(key, nextBuffer, batch);
    return false;
  }

  private storeBuffer(key: string, buffer: WorkflowBatchBufferState): void {
    const buffers = this.store.getBatchBuffers();
    buffers[key] = buffer;
    this.store.setBatchBuffers(buffers);
  }

  private flushBuffer(key: string, reason: WorkflowBatchFlushReason): boolean {
    const buffers = this.store.getBatchBuffers();
    const buffer = buffers[key];
    if (!buffer) return false;
    const target = this.findTargetForBuffer(buffer);
    if (!target) {
      delete buffers[key];
      this.store.setBatchBuffers(buffers);
      this.clearTimer(key);
      return false;
    }

    delete buffers[key];
    this.store.setBatchBuffers(buffers);
    this.clearTimer(key);

    const payload: WorkflowBatchFlushPayload = {
      scopeId: buffer.scopeId,
      projectId: buffer.projectId,
      sourceEventName: buffer.sourceEventName,
      groupingKey: buffer.groupingKey,
      reason,
      count: buffer.inputEvents.length,
      window: {
        firstEventAt: buffer.firstEventAt,
        lastEventAt: buffer.lastEventAt,
        flushedAt: new Date().toISOString(),
      },
      inputEvents: buffer.inputEvents,
      batch: {
        workflow: buffer.definitionName,
        triggerIndex: buffer.triggerIndex,
        maxBufferSize: target.trigger.batch!.maxBufferSize,
        overflow: target.trigger.batch!.overflow,
        droppedInputCount: buffer.droppedInputCount,
      },
    };
    this.enqueueRun(target.definition, target.trigger, {
      event: WORKFLOW_BATCH_FLUSH_EVENT,
      schemaRef: null,
      payload,
    });
    this.getProjectBus().emitDynamic(WORKFLOW_BATCH_FLUSH_EVENT, payload);
    return true;
  }

  private findTargetForBuffer(buffer: WorkflowBatchBufferState): BatchTarget | null {
    const definition = this.definitions.find(
      (candidate) => candidate.name === buffer.definitionName,
    );
    if (!definition?.enabled) return null;
    const trigger = definition.triggers[buffer.triggerIndex];
    if (!trigger?.batch) return null;
    if (trigger.event !== buffer.sourceEventName) return null;
    return { definition, trigger, triggerIndex: buffer.triggerIndex };
  }

  private scheduleBuffer(
    key: string,
    buffer: WorkflowBatchBufferState,
    batch: WorkflowBatchTrigger,
  ): void {
    this.clearTimer(key);
    const due = nextTimerDue(buffer, batch);
    if (!due) return;
    const delayMs = Math.max(0, due.atMs - Date.now());
    const timer = setTimeout(() => {
      if (this.isStopping()) return;
      if (this.flushBuffer(key, due.reason)) this.maybeStartNext();
    }, delayMs);
    timer.unref();
    this.timers.set(key, timer);
  }

  private clearTimer(key: string): void {
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
  }

  private clearTimers(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}

function createBuffer(
  definition: WorkflowDefinition,
  triggerIndex: number,
  scopeId: string,
  group: Extract<GroupResolution, { ok: true }>,
  inputEvent: WorkflowBatchInputEventEnvelope,
): WorkflowBatchBufferState {
  return {
    definitionName: definition.name,
    triggerIndex,
    sourceEventName: inputEvent.event,
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

function nextTimerDue(
  buffer: WorkflowBatchBufferState,
  batch: WorkflowBatchTrigger,
): TimerDue | null {
  const due: TimerDue[] = [];
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

function resolveGroup(batch: WorkflowBatchTrigger, payload: EventPayload): GroupResolution {
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

function payloadPathValue(
  payload: EventPayload,
  path: string,
): EventPayloadValue {
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

function explicitScope(payload: EventPayload): string | undefined {
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

function bufferKey(
  definitionName: string,
  triggerIndex: number,
  scopeId: string,
  groupingKey: string,
): string {
  return [definitionName, String(triggerIndex), scopeId, groupingKey].join("\u0000");
}
