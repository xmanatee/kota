import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { EventBus } from "#core/events/event-bus.js";
import { ProjectScopedEventBus } from "#core/events/project-scope.js";
import { WorkflowEventBatchManager } from "#core/workflow/event-batches.js";
import { ProjectRuntimeStateStore } from "#core/workflow/project-runtime-state.js";
import { RunStateDatabase } from "#core/workflow/run-state-database.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
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
  const tempProjectDir = mkdtempSync(join(tmpdir(), "kota-workflow-simulation-"));
  const bus = new EventBus();
  const store = new WorkflowRunStore(tempProjectDir);
  const projectId = deriveDirectoryScopeId(tempProjectDir);
  const runState = new RunStateDatabase(join(store.rootDir, "state"));
  runState.registerProject({
    id: projectId,
    rootPath: tempProjectDir,
    createdAt: new Date().toISOString(),
  });
  const projectState = new ProjectRuntimeStateStore(runState, projectId);
  const queuedFlushes: QueuedBatchFlushPreview[] = [];
  const scopedBuses = new Map<string, ProjectScopedEventBus>();
  let currentScopeId = "default";

  const projectBus = (): ProjectScopedEventBus => {
    const existing = scopedBuses.get(currentScopeId);
    if (existing) return existing;
    const created = new ProjectScopedEventBus(bus, currentScopeId);
    scopedBuses.set(currentScopeId, created);
    return created;
  };

  const manager = new WorkflowEventBatchManager(
    projectState,
    () => false,
    (definition, _trigger, runTrigger) => {
      queuedFlushes.push({ definition, runTrigger });
    },
    () => {},
    projectBus,
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
      rmSync(tempProjectDir, { recursive: true, force: true });
    },
  };
}
