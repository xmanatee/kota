import type { BusEnvelope } from "#core/events/event-bus.js";
import type { ProjectScopedEventBus } from "#core/events/project-scope.js";
import {
  clearWorkflowBatchTimer,
  clearWorkflowBatchTimers,
  createWorkflowBatchBuffer,
  createWorkflowBatchFlushPayload,
  createWorkflowBatchInputEvent,
  explicitWorkflowBatchScope,
  findWorkflowBatchTarget,
  matchingWorkflowBatchManualFlushKeys,
  resolveWorkflowBatchGroup,
  scheduleWorkflowBatchTimer,
  type WorkflowBatchTarget,
  type WorkflowBatchTimerMap,
  workflowBatchBufferKey,
} from "./event-batch-helpers.js";
import type { ProjectRuntimeStateStore } from "./project-runtime-state.js";
import {
  matchesFilter,
  workflowEventTriggeringAllowed,
} from "./run-executor-utils.js";
import {
  WORKFLOW_BATCH_FLUSH_EVENT,
  type WorkflowBatchBufferState,
  type WorkflowBatchBuffers,
  type WorkflowBatchFlushReason,
  type WorkflowBatchTrigger,
  type WorkflowRunTrigger,
  type WorkflowTrigger,
} from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";

type EnqueueRun = (
  definition: WorkflowDefinition,
  trigger: WorkflowTrigger,
  runTrigger: WorkflowRunTrigger,
) => void;

export type WorkflowBatchDispatchInput = {
  workflowName: string;
  event: string;
  schemaRef: BusEnvelope["schemaRef"];
  eventId?: string;
  payload: BusEnvelope["payload"];
  batch: WorkflowBatchTrigger;
};

export type WorkflowBatchDispatchResult =
  | { ok: true; status: "batched" | "queued" }
  | {
      ok: false;
      reason: "unknown_workflow" | "disabled_workflow" | "invalid_group";
      message: string;
    };

export class WorkflowEventBatchManager {
  private definitions: WorkflowDefinition[] = [];
  private readonly timers: WorkflowBatchTimerMap = new Map();

  constructor(
    private readonly store: ProjectRuntimeStateStore,
    private readonly isStopping: () => boolean,
    private readonly enqueueRun: EnqueueRun,
    private readonly maybeStartNext: () => void,
    private readonly getProjectBus: () => ProjectScopedEventBus,
    private readonly log: (message: string) => void,
  ) {}

  setup(definitions: WorkflowDefinition[]): void {
    this.definitions = definitions;
    clearWorkflowBatchTimers(this.timers);

    const current = this.store.getBatchBuffers();
    const retained: WorkflowBatchBuffers = {};
    for (const [key, buffer] of Object.entries(current)) {
      const target = findWorkflowBatchTarget(this.definitions, buffer);
      if (!target) continue;
      retained[key] = buffer;
    }
    if (Object.keys(retained).length !== Object.keys(current).length) {
      this.store.setBatchBuffers(retained);
    }
    for (const [key, buffer] of Object.entries(retained)) {
      const target = findWorkflowBatchTarget(this.definitions, buffer);
      if (target) this.scheduleBuffer(key, buffer, target.trigger.batch!);
    }
  }

  clearAll(): void {
    clearWorkflowBatchTimers(this.timers);
    this.definitions = [];
  }

  handleEvent(envelope: BusEnvelope): void {
    if (this.isStopping()) return;
    let flushed = this.flushManualMatches(envelope);
    if (!workflowEventTriggeringAllowed(envelope.type)) {
      if (flushed) this.maybeStartNext();
      return;
    }

    for (const definition of this.definitions) {
      if (!definition.enabled) continue;
      for (let triggerIndex = 0; triggerIndex < definition.triggers.length; triggerIndex++) {
        const trigger = definition.triggers[triggerIndex]!;
        if (!trigger.batch) continue;
        if (trigger.event !== envelope.type) continue;
        if (!matchesFilter(trigger.filter, envelope.payload)) continue;
        const result = this.addEventToBuffer(
          { definition, trigger, triggerIndex },
          envelope,
        );
        if (!result.ok) {
          this.log(
            `Skipped workflow batch input for "${definition.name}" from event "${envelope.type}": ${result.reason}`,
          );
          continue;
        }
        flushed = result.flushed || flushed;
      }
    }

    if (flushed) this.maybeStartNext();
  }

  dispatchToWorkflowBatch(
    input: WorkflowBatchDispatchInput,
  ): WorkflowBatchDispatchResult {
    const definition = this.definitions.find(
      (candidate) => candidate.name === input.workflowName,
    );
    if (!definition) {
      return {
        ok: false,
        reason: "unknown_workflow",
        message: `Unknown workflow "${input.workflowName}"`,
      };
    }
    if (!definition.enabled) {
      return {
        ok: false,
        reason: "disabled_workflow",
        message: `Workflow "${input.workflowName}" is disabled`,
      };
    }

    const target: WorkflowBatchTarget = {
      definition,
      trigger: {
        event: input.event,
        cooldownMs: 0,
        batch: input.batch,
      },
      triggerIndex: -1,
    };
    const envelope: BusEnvelope = {
      type: input.event,
      schemaRef: input.schemaRef,
      ...(input.eventId !== undefined ? { eventId: input.eventId } : {}),
      payload: input.payload,
    };
    const result = this.addEventToBuffer(target, envelope);
    if (!result.ok) {
      return {
        ok: false,
        reason: "invalid_group",
        message: result.reason,
      };
    }
    if (result.flushed) {
      this.maybeStartNext();
      return { ok: true, status: "queued" };
    }
    return { ok: true, status: "batched" };
  }

  private flushManualMatches(envelope: BusEnvelope): boolean {
    let flushed = false;
    const keys = matchingWorkflowBatchManualFlushKeys({
      definitions: this.definitions,
      buffers: this.store.getBatchBuffers(),
      envelope,
    });
    for (const key of keys) {
      flushed = this.flushBuffer(key, "manual") || flushed;
    }
    return flushed;
  }

  private addEventToBuffer(
    target: WorkflowBatchTarget,
    envelope: BusEnvelope,
  ): { ok: true; flushed: boolean } | { ok: false; reason: string } {
    const { definition, trigger, triggerIndex } = target;
    const batch = trigger.batch!;
    const scopeId = explicitWorkflowBatchScope(envelope.payload) ?? this.getProjectBus().getScopeId();
    const group = resolveWorkflowBatchGroup(batch, envelope.payload);
    if (!group.ok) {
      return group;
    }

    const key = workflowBatchBufferKey(definition.name, triggerIndex, scopeId, group.groupingKey);
    const receivedAt = new Date().toISOString();
    const inputEvent = createWorkflowBatchInputEvent(envelope, receivedAt);
    const buffers = this.store.getBatchBuffers();
    const existing = buffers[key];

    if (existing && existing.inputEvents.length >= batch.maxBufferSize) {
      if (batch.overflow === "drop-newest") {
        buffers[key] = {
          ...existing,
          droppedInputCount: existing.droppedInputCount + 1,
        };
        this.store.setBatchBuffers(buffers);
        return { ok: true, flushed: false };
      }

      const flushed = this.flushBuffer(key, "overflow");
      const replacement = createWorkflowBatchBuffer(target, scopeId, group, inputEvent);
      this.storeBuffer(key, replacement);
      if (batch.maxCount !== undefined && replacement.inputEvents.length >= batch.maxCount) {
        return { ok: true, flushed: this.flushBuffer(key, "count") || flushed };
      }
      this.scheduleBuffer(key, replacement, batch);
      return { ok: true, flushed };
    }

    const nextBuffer = existing
      ? {
          ...existing,
          lastEventAt: receivedAt,
          inputEvents: [...existing.inputEvents, inputEvent],
        }
      : createWorkflowBatchBuffer(target, scopeId, group, inputEvent);

    this.storeBuffer(key, nextBuffer);

    if (batch.maxCount !== undefined && nextBuffer.inputEvents.length >= batch.maxCount) {
      return { ok: true, flushed: this.flushBuffer(key, "count") };
    }
    this.scheduleBuffer(key, nextBuffer, batch);
    return { ok: true, flushed: false };
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
    const target = findWorkflowBatchTarget(this.definitions, buffer);
    if (!target) {
      delete buffers[key];
      this.store.setBatchBuffers(buffers);
      clearWorkflowBatchTimer(this.timers, key);
      return false;
    }

    delete buffers[key];
    this.store.setBatchBuffers(buffers);
    clearWorkflowBatchTimer(this.timers, key);

    const payload = createWorkflowBatchFlushPayload({
      buffer,
      batch: target.trigger.batch!,
      reason,
      flushedAt: new Date().toISOString(),
    });
    this.enqueueRun(target.definition, target.trigger, {
      event: WORKFLOW_BATCH_FLUSH_EVENT,
      schemaRef: null,
      payload,
    });
    this.getProjectBus().emitDynamic(WORKFLOW_BATCH_FLUSH_EVENT, payload);
    return true;
  }

  private scheduleBuffer(
    key: string,
    buffer: WorkflowBatchBufferState,
    batch: WorkflowBatchTrigger,
  ): void {
    scheduleWorkflowBatchTimer({
      timers: this.timers,
      key,
      buffer,
      batch,
      onDue: (reason) => {
        if (this.isStopping()) return;
        if (this.flushBuffer(key, reason)) this.maybeStartNext();
      },
    });
  }
}
