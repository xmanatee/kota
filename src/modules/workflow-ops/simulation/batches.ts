import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ScopedEventBus } from "#core/events/scope.js";
import { WorkflowEventBatchManager } from "#core/workflow/event-batches.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { ScopeRuntimeStateStore } from "#core/workflow/scope-runtime-state.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import type { WorkflowDefinition } from "#core/workflow/types.js";
import {
  busEnvelopeForEvent,
  defaultScopeIdForEvent,
  type SimulationEvent,
} from "./events.js";

export type QueuedBatchFlushPreview = {
  definition: WorkflowDefinition;
  runTrigger: WorkflowRunTrigger;
};

export type BatchSimulationState = {
  handleEvent(event: SimulationEvent): QueuedBatchFlushPreview[];
  cleanup(): void;
};

export function eventFromQueuedBatchFlush(
  flush: QueuedBatchFlushPreview,
): SimulationEvent {
  return {
    source: {
      kind: "batch-flush",
      label: flush.definition.name,
    },
    event: flush.runTrigger.event,
    payload: flush.runTrigger.payload,
    schemaRef: flush.runTrigger.schemaRef,
    ...(flush.runTrigger.eventId ? { eventId: flush.runTrigger.eventId } : {}),
  };
}

export function createBatchSimulationState(
  definitions: readonly WorkflowDefinition[],
): BatchSimulationState {
  const tempScopeRoot = mkdtempSync(join(tmpdir(), "kota-workflow-simulation-"));
  const bus = new EventBus();
  const store = new WorkflowRunStore(tempScopeRoot);
  const scopeId = deriveDirectoryScopeId(tempScopeRoot);
  const runState = new RunStateDatabase(join(store.rootDir, "state"));
  runState.registerScope({
    id: scopeId,
    rootPath: tempScopeRoot,
    createdAt: new Date().toISOString(),
  });
  const scopeState = new ScopeRuntimeStateStore(runState, scopeId);
  const queuedFlushes: QueuedBatchFlushPreview[] = [];
  const scopedBuses = new Map<string, ScopedEventBus>();
  let currentScopeId = "default";

  const scopeBus = (): ScopedEventBus => {
    const existing = scopedBuses.get(currentScopeId);
    if (existing) return existing;
    const created = new ScopedEventBus(bus, currentScopeId);
    scopedBuses.set(currentScopeId, created);
    return created;
  };

  const manager = new WorkflowEventBatchManager(
    scopeState,
    () => false,
    (definition, _trigger, runTrigger) => {
      queuedFlushes.push({ definition, runTrigger });
    },
    () => {},
    scopeBus,
    () => {},
  );
  manager.setup([...definitions]);

  return {
    handleEvent(event) {
      const before = queuedFlushes.length;
      currentScopeId = defaultScopeIdForEvent(event);
      manager.handleEvent(busEnvelopeForEvent(event));
      return queuedFlushes.slice(before);
    },
    cleanup() {
      manager.clearAll();
      runState.close();
      rmSync(tempScopeRoot, { recursive: true, force: true });
    },
  };
}
