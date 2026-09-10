import type { ScopedEventBus } from "#core/events/scope.js";
import type { DurableEffectValue, TransactionalRunState } from "./run-context.js";
import type { RunExecutionOutcome } from "./run-coordinator.js";
import type { RunStateDatabase, StoredRun } from "./run-state-database.js";
import type { WorkflowDefinition, WorkflowFinalizationContext } from "./types.js";

/** Attach only after lifecycle success, including recovery without a sandbox. */
export function withWorkflowFinalization<T extends RunExecutionOutcome>(
  outcome: T,
  input: {
    definition: Pick<WorkflowDefinition, "finalize">;
    run: StoredRun;
    store: RunStateDatabase;
    stateDir: string;
    pbus: Pick<ScopedEventBus, "prepareDynamic">;
    stepOutputs: WorkflowFinalizationContext["stepOutputs"];
  },
): T {
  const finalize = input.definition.finalize;
  if (outcome.kind !== "terminal" || outcome.state !== "succeeded" || !finalize) {
    return outcome;
  }
  return {
    ...outcome,
    finalize: () => {
      const { run, store } = input;
      const scopeRoot = store.getScopeRoot(run.scopeId);
      if (!scopeRoot) throw new Error(`Unknown scope "${run.scopeId}"`);
      let active = true;
      const assertActive = () => {
        if (!active) throw new Error("Workflow finalization context is no longer active");
      };
      const state: TransactionalRunState = Object.freeze({
        read<TValue extends DurableEffectValue>(key: string) {
          assertActive();
          return Object.freeze(store.readScopeStateValue<TValue>(run.scopeId, key));
        },
        compareAndSet<TValue extends DurableEffectValue>(key: string, expectedRevision: number, value: TValue) {
          assertActive();
          store.stageScopeStateMutation({
            runId: run.id, key, expectedRevision, value, stagedAt: new Date().toISOString(),
          });
        },
      });
      try {
        const result: unknown = finalize(Object.freeze({
          runId: run.id,
          scopeId: run.scopeId,
          scopeRoot,
          stateDir: input.stateDir,
          trigger: structuredClone(run.trigger),
          stepOutputs: structuredClone(input.stepOutputs),
          state,
          emit(event: string, payload: Readonly<Record<string, unknown>>, stepId: string) {
            assertActive();
            const preparedPayload = input.pbus.prepareDynamic(event, payload);
            store.stageEmitIntent({
              runId: run.id, stepId, event, payload: preparedPayload, stagedAt: new Date().toISOString(),
            });
          },
        }));
        if (
          result !== null &&
          (typeof result === "object" || typeof result === "function") &&
          "then" in result && typeof result.then === "function"
        ) {
          // The synchronous contract violation is reported by the coordinator;
          // consume a later rejection so it cannot escape that failure boundary.
          void Promise.resolve(result).catch(() => undefined);
          throw new Error("Workflow finalize must be synchronous; returned a Promise");
        }
      } finally {
        active = false;
      }
    },
  };
}
