import type { EventEmitFailure } from "#core/events/event-bus.js";
import { createEventEnvelopeDeadLetter } from "./dead-letter-queue.js";
import type { ScopeRegistry } from "./scope-registry.js";
import type { ScopeRuntime, ScopeRuntimeRegistry } from "./scope-runtime.js";

export function scopeLineageForId(scopeId: string, registry: ScopeRegistry): readonly string[] {
  const projection = registry.toProjection();
  const byId = new Map(projection.scopes.map((scope) => [scope.scopeId, scope]));
  const lineage: string[] = [];
  let current = byId.get(scopeId);
  while (current) {
    lineage.unshift(current.scopeId);
    const parentId = current.parentScopeId;
    current = parentId ? byId.get(parentId) : undefined;
  }
  return lineage.length > 0 ? lineage : [scopeId];
}

export function recordEventEmitFailureDeadLetter(input: {
  failure: EventEmitFailure;
  runtimes: ScopeRuntimeRegistry;
  defaultScopeId: string;
  log: (message: string) => void;
}): void {
  const runtime = runtimeForEventFailure(
    input.failure,
    input.runtimes,
    input.defaultScopeId,
    input.log,
  );
  if (runtime === null) return;
  createEventEnvelopeDeadLetter({
    store: runtime.deadLetterQueue,
    scopeId: runtime.scope.scopeId,
    eventName: input.failure.event,
    schemaRef: input.failure.schemaRef,
    payload: input.failure.payload,
    redriveEnvelope: input.failure.envelope,
    reason: input.failure.error.message,
    errorClass: input.failure.stage === "validation" ? "validation" : "execution",
    owningModule: "event-runtime",
  });
}

function runtimeForEventFailure(
  failure: EventEmitFailure,
  runtimes: ScopeRuntimeRegistry,
  defaultScopeId: string,
  log: (message: string) => void,
): ScopeRuntime | null {
  const payloadScopeId = scopeIdFromPayload(failure.payload);
  if (payloadScopeId === null) {
    log(
      `Event "${failure.event}" failed with conflicting scope selectors; ` +
        "no scope DLQ was selected",
    );
    return null;
  }
  const scopeId = payloadScopeId ?? defaultScopeId;
  try {
    return runtimes.get(scopeId);
  } catch (error) {
    log(
      `Event "${failure.event}" failed before dispatch with unknown scope "${scopeId}"; ` +
        `no scope DLQ was selected: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

function scopeIdFromPayload(
  payload: EventEmitFailure["payload"],
): string | null | undefined {
  return typeof payload.scopeId === "string" && payload.scopeId.length > 0
    ? payload.scopeId
    : undefined;
}
