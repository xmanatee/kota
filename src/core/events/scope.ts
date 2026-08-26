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
 * `scopeId` is the sole emitted identity field for directory-backed scopes.
 */

import type { EventBus } from "./event-bus.js";
import type {
  BusEnvelope,
  BusEventHandler,
  BusEvents,
  ScopedBusEventName,
  ScopedBusEventPayload,
} from "./event-bus-types.js";
import {
  defineModuleEvent,
  getModuleEventRegistry,
  type ModuleEventDef,
  type ModuleEventOptions,
  type ModuleEventPayload,
  type ModuleEventPayloadSchema,
  type ModuleEventSchemaNode,
  type ModuleEventSchemaProperties,
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
 * Helper that adds the required canonical `scopeId` field to a base payload.
 */
export type ScopedPayload<T extends Payload = Payload> = T & {
  scopeId: ScopeId;
};

/**
 * Discriminated event scope. `kind: "scope"` events carry `scopeId`;
 * `kind: "daemon"` events are daemon-wide.
 */
export type EventScope =
  | { kind: "scope"; scopeId: ScopeId }
  | { kind: "daemon" };

/**
 * Typed module event whose payload is always directory-scope attributed. Subscribers
 * always see a typed `scopeId`; emitters either supply it directly through
 * the raw `EventBus` or go through {@link ScopedEventBus}, which
 * injects it.
 */
export type ScopedModuleEventDef<TPayload extends Payload = Payload> =
  ModuleEventDef<ScopedPayload<TPayload>>;

/**
 * Declare a directory-scope module event. The runtime fields list always
 * includes `scopeId` so workflow trigger filters can use the canonical
 * selector.
 */
export function defineScopedModuleEvent<TPayload extends Payload>(
  name: string,
  fields: ReadonlyArray<keyof TPayload & string>,
  options?: ModuleEventOptions<ScopedPayload<TPayload>>,
): ScopedModuleEventDef<TPayload> {
  const allFields: ReadonlyArray<keyof ScopedPayload<TPayload> & string> = [
    "scopeId",
    ...fields,
  ];
  const scopedOptions = {
    ...options,
    payloadSchema: withScopePayloadSchema(
      options?.payloadSchema ?? payloadSchemaFromFields(fields),
    ),
    filterablePaths: options?.filterablePaths
      ? ["scopeId", ...options.filterablePaths]
      : undefined,
  };
  return defineModuleEvent<ScopedPayload<TPayload>>(
    name,
    allFields,
    "scope",
    scopedOptions,
  );
}

function withScopePayloadSchema(
  schema: ModuleEventPayloadSchema,
): ModuleEventPayloadSchema {
  const properties: ModuleEventSchemaProperties = {
    scopeId: { type: "string", required: true },
    ...schema.properties,
  };
  return { ...schema, properties };
}

function payloadSchemaFromFields(
  fields: ReadonlyArray<string>,
): ModuleEventPayloadSchema {
  const properties: { [key: string]: ModuleEventSchemaNode } = {};
  for (const field of fields) {
    properties[field] = { type: "json" };
  }
  return {
    type: "object",
    properties,
    additionalProperties: true,
  };
}

/**
 * Per-scope view over a shared underlying {@link EventBus}.
 *
 * Constructed once per directory scope by the daemon's runtime bundle. Emit
 * injects `scopeId` into the payload; subscribe
 * filters delivery so the subscriber only sees this view's scope. Cross-scope
 * listeners that want every scope's events still go through the raw bus.
 *
 * The wrapper does not own the underlying bus's lifecycle. Multiple views
 * share one bus, and clearing the bus clears every view.
 */
export class ScopedEventBus {
  constructor(
    private readonly bus: EventBus,
    private readonly scopeId: ScopeId,
  ) {}

  /** This view's stable scope id. */
  getScopeId(): ScopeId {
    return this.scopeId;
  }

  /** The underlying shared bus. Use sparingly — most callers should not need it. */
  getUnderlying(): EventBus {
    return this.bus;
  }

  /** Emit a module-declared event with scope attribution injected. */
  emit<TPayload extends Payload>(
    event: ScopedModuleEventDef<TPayload>,
    payload: TPayload,
  ): void;
  /**
   * Emit a directory-scoped {@link BusEvents} entry. The wrapper injects this
   * view's `scopeId` so callers do not have to thread it through every call
   * site. Only `BusEvents` keys whose static payload carries `scopeId` are
   * accepted — daemon-wide events go through the raw bus.
   */
  emit<K extends ScopedBusEventName>(
    event: K,
    payload: ScopedBusEventPayload<K>,
  ): void;
  emit(
    event: ScopedModuleEventDef | ScopedBusEventName,
    payload: Payload,
  ): void {
    const fullPayload = withScopeAttribution(payload, this.scopeId);
    if (typeof event === "string") {
      this.bus.emit(event, fullPayload as BusEvents[ScopedBusEventName]);
      return;
    }
    this.bus.emit(event, fullPayload);
  }

  /**
   * Subscribe to a directory-scoped event. The handler only fires for payloads
   * tagged with this view's scope. Returns an unsubscribe function.
   */
  on<E extends ScopedModuleEventDef>(
    event: E,
    handler: (payload: ModuleEventPayload<E>) => void,
  ): () => void;
  on<K extends ScopedBusEventName>(
    event: K,
    handler: (payload: BusEvents[K]) => void,
  ): () => void;
  on(
    event: ScopedModuleEventDef | ScopedBusEventName,
    handler: (payload: Payload) => void,
  ): () => void {
    if (typeof event === "string") {
      return this.bus.on(event, (payload: BusEvents[ScopedBusEventName]) => {
        if (!payloadBelongsToScope(payload, this.scopeId)) return;
        (handler as BusEventHandler<BusEvents[ScopedBusEventName]>)(payload);
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
   * where the event name is dynamic. Always injects canonical `scopeId` for
   * scope-scoped events. A caller-supplied selector must match this bus view
   * so one scope cannot emit another scope's runtime event by accident.
   */
  emitDynamic(event: string, payload: Payload, eventId?: string): Payload {
    const emittedPayload = this.prepareDynamic(event, payload);
    this.bus.emit(event, emittedPayload, eventId);
    return emittedPayload;
  }

  /** Deliver a scoped event whose identity and retry lifecycle are owned by the workflow outbox. */
  deliverOutbox(event: string, payload: Payload, eventId: string): Payload {
    const emittedPayload = this.prepareDynamic(event, payload);
    this.bus.deliverOutbox(event, emittedPayload, eventId);
    return emittedPayload;
  }

  /** Validate and scope a dynamic event without making it visible to subscribers. */
  prepareDynamic(event: string, payload: Payload): Payload {
    const preparedPayload = shouldInjectDynamicScope(event)
      ? withScopeAttribution(payload, this.scopeId)
      : payload;
    this.bus.validate(event, preparedPayload);
    return preparedPayload;
  }
}

function shouldInjectDynamicScope(event: string): boolean {
  const registration = getModuleEventRegistry()?.get(event);
  return registration?.scope !== "daemon";
}

function explicitPayloadScope(payload: Payload): ScopeId | undefined {
  return typeof payload.scopeId === "string" && payload.scopeId.length > 0
    ? payload.scopeId
    : undefined;
}

function withScopeAttribution(
  payload: Payload,
  scopeId: ScopeId,
): ScopedPayload {
  const explicit = explicitPayloadScope(payload);
  if (explicit && explicit !== scopeId) {
    throw new Error(
      `Event payload selector ${explicit} does not match scoped bus ${scopeId}`,
    );
  }
  return { ...payload, scopeId };
}

function payloadBelongsToScope(payload: Payload, scopeId: ScopeId): boolean {
  const explicit = explicitPayloadScope(payload);
  return explicit === undefined || explicit === scopeId;
}
