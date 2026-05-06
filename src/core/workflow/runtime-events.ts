import type { BusEnvelope } from "#core/events/event-bus.js";
import { enqueueMatchingWorkflows } from "./run-executor-utils.js";
import { formatRunId } from "./run-io.js";
import { maybeStartNext, type WorkflowRuntimeDispatchState } from "./runtime-dispatch.js";
import type { WorkflowDefinition, WorkflowRunTrigger } from "./types.js";

export type WorkflowRuntimeEventsState = WorkflowRuntimeDispatchState;

export function handleRuntimeEvent(
  state: WorkflowRuntimeEventsState,
  envelope: BusEnvelope,
): void {
  if (state.stopping) return;
  enqueueMatchingWorkflows(envelope, state.definitions, (def, trigger, run) =>
    state.wfQueue.enqueue(def, trigger, run),
  );
  maybeStartNext(state);
}

/**
 * Match an event against the current definitions and prepend matching runs to
 * the queue, evicting any existing entries for the same workflows. Used by the
 * recovery phase so a `runtime.recovered` dispatch jumps the queue ahead of
 * any normal scheduled work.
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
    { type: event, payload },
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
    .filter((run) => !queuedNames.has(run.workflowName));
  state.wfQueue.setRuns([
    ...queued.map(({ workflowName, trigger }) => {
      const runId =
        typeof trigger.payload._runId === "string" && trigger.payload._runId.trim().length > 0
          ? trigger.payload._runId
          : formatRunId(workflowName);
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
