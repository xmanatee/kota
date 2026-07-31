import type { BusEnvelope } from "#core/events/event-bus.js";
import type { WorkflowEventBatchManager } from "./event-batches.js";
import { enqueueMatchingWorkflows } from "./run-executor-utils.js";
import { formatRunId } from "./run-io.js";
import { maybeStartNext, type WorkflowRuntimeDispatchState } from "./runtime-dispatch.js";
import type { WorkflowRunTrigger } from "./trigger-types.js";
import type { WorkflowDefinition } from "./types.js";
import { hasExplicitWorkflowDispatchKey } from "./workflow-idempotency.js";

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

/**
 * Match an event against the current definitions and prepend matching runs to
 * the queue, evicting replaceable entries for the same workflows. Explicitly
 * keyed deliveries survive because their accepted idempotency record prevents
 * a recovery scan from recreating them. Used by the recovery phase so a
 * `runtime.recovered` dispatch jumps ahead of normal scheduled work without
 * stranding durable queued work.
 *
 * Returns the number of runs that were queued.
 */
export function queueMatchingEventFirst(
  state: WorkflowRuntimeEventsState,
  event: string,
  payload: Record<string, unknown>,
  definitionFilter?: (def: WorkflowDefinition) => boolean,
): number {
  const filteredDefs = definitionFilter
    ? state.definitions.filter(definitionFilter)
    : state.definitions;
  const queued: Array<{
    workflowName: string;
    trigger: WorkflowRunTrigger;
  }> = [];
  enqueueMatchingWorkflows(
    { type: event, schemaRef: null, payload },
    filteredDefs,
    (definition, _trigger, run) => {
      queued.push({ workflowName: definition.name, trigger: run });
    },
  );
  if (queued.length === 0) return 0;

  const now = Date.now();
  const queuedNames = new Set(queued.map((run) => run.workflowName));
  const remaining = state.wfQueue
    .getRuns()
    .filter(
      (run) =>
        !queuedNames.has(run.workflowName) ||
        hasExplicitWorkflowDispatchKey(run.trigger),
    );
  state.wfQueue.setRuns([
    ...queued.map(({ workflowName, trigger }) => {
      const runId = formatRunId(workflowName);
      return {
        runId,
        workflowName,
        trigger: {
          ...trigger,
          payload: {
            ...trigger.payload,
            _runId: runId,
          },
        },
        enqueuedAtMs: 0,
        notBeforeMs: now,
      };
    }),
    ...remaining,
  ]);
  state.wfQueue.persist();
  return queued.length;
}
