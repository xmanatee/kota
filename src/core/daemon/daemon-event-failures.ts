import type { EventEmitFailure } from "#core/events/event-bus.js";
import { createEventEnvelopeDeadLetter } from "./dead-letter-queue.js";
import type { ProjectRuntime, ProjectRuntimeRegistry } from "./project-runtime.js";
import type { ScopeRegistry } from "./scope-registry.js";

export function scopeLineageForId(scopeId: string, registry: ScopeRegistry): readonly string[] {
  const projection = registry.toScopeProjection();
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
  runtimes: ProjectRuntimeRegistry;
  defaultProjectId: string;
  log: (message: string) => void;
}): void {
  const runtime = runtimeForEventFailure(
    input.failure,
    input.runtimes,
    input.defaultProjectId,
    input.log,
  );
  createEventEnvelopeDeadLetter({
    store: runtime.deadLetterQueue,
    scopeId: runtime.project.projectId,
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
  runtimes: ProjectRuntimeRegistry,
  defaultProjectId: string,
  log: (message: string) => void,
): ProjectRuntime {
  const scopeId = scopeIdFromPayload(failure.payload) ?? defaultProjectId;
  try {
    return runtimes.get(scopeId);
  } catch (error) {
    log(
      `Event "${failure.event}" failed before dispatch with unknown scope "${scopeId}"; recording DLQ item under default scope ${runtimes.getDefaultProjectId()}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return runtimes.getDefault();
  }
}

function scopeIdFromPayload(payload: EventEmitFailure["payload"]): string | undefined {
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
