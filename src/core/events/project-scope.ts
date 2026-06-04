/**
 * Scope primitives for the typed event bus.
 *
 * The KOTA daemon hosts one or more configured scopes. Most runtime events
 * belong to a specific directory-backed scope (workflow runs, queue shape,
 * approvals, sessions). A few are daemon-wide (registry change, daemon
 * lifecycle).
 *
 * This module owns the typed primitives that distinguish the two and the
 * wrapper bus per-scope subsystems use to emit / subscribe without threading
 * scope identity through every call. The runtime registry that derives ids
 * from directory roots and tracks configured directory scopes lives in
 * `#core/daemon/scope-registry.js`; the type alias is owned here so
 * `events/` and other foundational subsystems can import it without taking a
 * daemon-tree dependency.
 *
 * `scopeId` is the canonical emitted field. `projectId` remains a
 * compatibility field for directory-backed scopes while clients and route
 * selectors migrate.
 */

import type { EventBus } from "./event-bus.js";
import type {
  BusEnvelope,
  BusEventHandler,
  BusEvents,
  ProjectScopedBusEventName,
  ProjectScopedBusEventPayload,
} from "./event-bus-types.js";
import {
  defineModuleEvent,
  type ModuleEventDef,
  type ModuleEventPayload,
} from "./module-event.js";

/** Object-shaped event payload constraint, used only inside this module. */
type Payload = Record<string, unknown>;

/**
 * Stable opaque scope identity. Re-exported as-is by the daemon scope
 * registry, where deterministic directory-scope derivation and the
 * file-backed registry live.
 */
export type ScopeId = string;

/**
 * Compatibility alias for directory-backed scopes whose public client and
 * route surfaces still use project language.
 */
export type ProjectId = ScopeId;

/**
 * Helper that adds the required canonical `scopeId` field plus the
 * directory-scope compatibility `projectId` field to a base payload type.
 */
export type ProjectScopedPayload<T extends Payload = Payload> = T & {
  scopeId: ScopeId;
  projectId: ProjectId;
};

/**
 * Discriminated event scope. `kind: "scope"` events carry a canonical
 * `scopeId` plus directory-scope compatibility `projectId`; `kind: "daemon"`
 * events are daemon-wide.
 */
export type EventScope =
  | { kind: "scope"; scopeId: ScopeId; projectId: ProjectId }
  | { kind: "daemon" };

/**
 * Typed module event whose payload is always directory-scope attributed. Subscribers
 * always see typed `scopeId` and `projectId` fields; emitters either supply
 * them directly through the raw `EventBus` or go through
 * {@link ProjectScopedEventBus}, which injects both.
 */
export type ProjectScopedModuleEventDef<TPayload extends Payload = Payload> =
  ModuleEventDef<ProjectScopedPayload<TPayload>>;

/**
 * Declare a directory-scope module event. The runtime fields list always
 * includes `scopeId` and `projectId` so workflow trigger filters can use the
 * canonical selector while existing projectId filters keep validating.
 */
export function defineProjectScopedModuleEvent<TPayload extends Payload>(
  name: string,
  fields: ReadonlyArray<keyof TPayload & string>,
): ProjectScopedModuleEventDef<TPayload> {
  const allFields: ReadonlyArray<keyof ProjectScopedPayload<TPayload> & string> = [
    "scopeId",
    "projectId",
    ...fields,
  ];
  return defineModuleEvent<ProjectScopedPayload<TPayload>>(
    name,
    allFields,
    "project",
  );
}

/**
 * Per-scope view over a shared underlying {@link EventBus}.
 *
 * Constructed once per directory scope by the daemon's runtime bundle. Emit
 * injects `scopeId` and compatibility `projectId` into the payload; subscribe
 * filters delivery so the subscriber only sees this view's scope. Cross-scope
 * listeners that want every scope's events still go through the raw bus.
 *
 * The wrapper does not own the underlying bus's lifecycle. Multiple views
 * share one bus, and clearing the bus clears every view.
 */
export class ProjectScopedEventBus {
  constructor(
    private readonly bus: EventBus,
    private readonly scopeId: ScopeId,
  ) {}

  /** This view's stable scope id. */
  getScopeId(): ScopeId {
    return this.scopeId;
  }

  /** Compatibility id for directory-backed scope callers that still say project. */
  getProjectId(): ProjectId {
    return this.scopeId;
  }

  /** The underlying shared bus. Use sparingly — most callers should not need it. */
  getUnderlying(): EventBus {
    return this.bus;
  }

  /** Emit a module-declared event with scope attribution injected. */
  emit<TPayload extends Payload>(
    event: ProjectScopedModuleEventDef<TPayload>,
    payload: TPayload,
  ): void;
  /**
   * Emit a directory-scoped {@link BusEvents} entry. The wrapper injects this
   * view's `scopeId` and compatibility `projectId` so callers do not have to
   * thread them through every call site. Only `BusEvents` keys whose static
   * payload carries `projectId` are accepted — daemon-wide events go through the
   * raw bus.
   */
  emit<K extends ProjectScopedBusEventName>(
    event: K,
    payload: ProjectScopedBusEventPayload<K>,
  ): void;
  emit(
    event: ProjectScopedModuleEventDef | ProjectScopedBusEventName,
    payload: Payload,
  ): void {
    const fullPayload = withScopeAttribution(payload, this.scopeId);
    if (typeof event === "string") {
      this.bus.emit(event, fullPayload as BusEvents[ProjectScopedBusEventName]);
      return;
    }
    this.bus.emit(event, fullPayload);
  }

  /**
   * Subscribe to a directory-scoped event. The handler only fires for payloads
   * tagged with this view's scope. Returns an unsubscribe function.
   */
  on<E extends ProjectScopedModuleEventDef>(
    event: E,
    handler: (payload: ModuleEventPayload<E>) => void,
  ): () => void;
  on<K extends ProjectScopedBusEventName>(
    event: K,
    handler: (payload: BusEvents[K]) => void,
  ): () => void;
  on(
    event: ProjectScopedModuleEventDef | ProjectScopedBusEventName,
    handler: (payload: Payload) => void,
  ): () => void {
    if (typeof event === "string") {
      return this.bus.on(event, (payload: BusEvents[ProjectScopedBusEventName]) => {
        if (!payloadBelongsToScope(payload, this.scopeId)) return;
        (handler as BusEventHandler<BusEvents[ProjectScopedBusEventName]>)(payload);
      });
    }
    return this.bus.on(event, (payload) => {
      if (!payloadBelongsToScope(payload, this.scopeId)) return;
      handler(payload);
    });
  }

  /**
   * Wildcard subscriber filtered to this view's scope. Daemon-wide events
   * (no scope selectors on payload) are delivered to every view; scoped events
   * are delivered only to the matching view. Directory-scope workflow runtimes
   * use this to subscribe without seeing other scopes' traffic.
   */
  onAny(handler: (envelope: BusEnvelope) => void): () => void {
    return this.bus.on("*", (envelope) => {
      if (!payloadBelongsToScope(envelope.payload, this.scopeId)) {
        return;
      }
      handler(envelope);
    });
  }

  /**
   * Untyped emit path used by step-author surfaces (workflow `ctx.emit`)
   * where the event name is dynamic. Always injects canonical `scopeId` and
   * compatibility `projectId` for scope-scoped events. A caller-supplied
   * selector must match this bus view so one scope cannot emit another
   * scope's runtime event by accident.
   */
  emitDynamic(event: string, payload: Record<string, unknown>): void {
    this.bus.emit(event, withScopeAttribution(payload, this.scopeId));
  }
}

function explicitPayloadScope(payload: Payload): ScopeId | undefined {
  const scopeId =
    typeof payload.scopeId === "string" && payload.scopeId.length > 0
      ? payload.scopeId
      : undefined;
  const projectId =
    typeof payload.projectId === "string" && payload.projectId.length > 0
      ? payload.projectId
      : undefined;
  if (scopeId && projectId && scopeId !== projectId) {
    throw new Error(
      `Conflicting scope selectors on event payload: scopeId=${scopeId}, projectId=${projectId}`,
    );
  }
  return scopeId ?? projectId;
}

function withScopeAttribution(
  payload: Payload,
  scopeId: ScopeId,
): ProjectScopedPayload {
  const explicit = explicitPayloadScope(payload);
  if (explicit && explicit !== scopeId) {
    throw new Error(
      `Event payload selector ${explicit} does not match scoped bus ${scopeId}`,
    );
  }
  return { ...payload, scopeId, projectId: scopeId };
}

function payloadBelongsToScope(payload: Payload, scopeId: ScopeId): boolean {
  const explicit = explicitPayloadScope(payload);
  return explicit === undefined || explicit === scopeId;
}
