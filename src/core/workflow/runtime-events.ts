import type { BusEnvelope } from "#core/events/event-bus.js";
import type { WorkflowEventBatchManager } from "./event-batches.js";
import { enqueueMatchingWorkflows } from "./run-executor-utils.js";
import { maybeStartNext, type WorkflowRuntimeDispatchState } from "./runtime-dispatch.js";

export type WorkflowRuntimeEventsState = WorkflowRuntimeDispatchState & {
  eventBatches: WorkflowEventBatchManager;
};

export function handleRuntimeEvent(
  state: WorkflowRuntimeEventsState,
  envelope: BusEnvelope,
): void {
  if (state.stopping) return;
  state.eventBatches.handleEvent(envelope);
  enqueueMatchingWorkflows(envelope, state.definitions, (def, trigger, run) =>
    state.wfQueue.enqueue(def, trigger, run),
  );
  maybeStartNext(state);
}
