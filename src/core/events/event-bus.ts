/**
 * EventBus — internal pub/sub for cross-module coordination.
 *
 * Typed events let modules react to each other without direct coupling.
 * Ephemeral: no persistence, no replay. Singleton pattern like Scheduler
 * and TaskStore.
 *
 * Used by: AgentSession (session lifecycle), WorkflowRuntime (workflow lifecycle),
 * Scheduler (schedule fires). Foundation for daemon mode and event-based triggers.
 */

export type {
  BusEnvelope,
  BusEventHandler,
  BusEvents,
  EventSchemaReference,
} from "./event-bus-types.js";

import type {
  BusEnvelope,
  BusEventHandler,
  BusEvents,
  EventSchemaReference,
} from "./event-bus-types.js";
import {
  assertModuleEventPayload,
  getModuleEventRegistry,
  type ModuleEventDef,
  type ModuleEventPayload,
  type ModuleEventPayloadObject,
} from "./module-event.js";

/**
 * Around-style emit middleware. Fires after the typed overload narrows the
 * payload but before any subscriber. Calling `next()` proceeds to the next
 * registered middleware, or — when the chain is exhausted — to subscriber
 * fan-out. Skipping `next()` suppresses the event entirely (no subscriber,
 * including wildcard, sees it). Re-entering the bus from inside a middleware
 * (`bus.emit(...)`) starts a fresh chain, so suppressing middlewares that
 * need to "release" buffered events should guard their own re-entry rather
 * than relying on the bus to skip them.
 */
export type EmitMiddleware = (envelope: BusEnvelope, next: () => void) => void;

export type EventEmitFailureStage = "validation" | "middleware" | "fanout";

export type EventEmitFailure = {
  event: string;
  schemaRef: EventSchemaReference | null;
  envelope: BusEnvelope;
  payload: BusEnvelope["payload"];
  error: Error;
  stage: EventEmitFailureStage;
};

export type EventEmitFailureHandler = (failure: EventEmitFailure) => void;

export function resolveEventSchemaReference(
  event: string | ModuleEventDef,
): EventSchemaReference | null {
  if (typeof event !== "string") {
    return { name: event.name, version: event.schema.currentVersion };
  }
  const registered = getModuleEventRegistry()?.get(event);
  return registered
    ? { name: registered.name, version: registered.currentVersion }
    : null;
}

/**
 * Typed event bus. Supports:
 * - `on(event, handler)` — subscribe, returns unsubscribe fn
 * - `once(event, handler)` — auto-unsubscribe after first call
 * - `emit(event, payload)` — synchronous fan-out to all handlers
 * - `on("*", handler)` — wildcard: receives BusEnvelope for every event
 * - `off(event, handler)` — explicit unsubscribe
 * - `addEmitMiddleware(mw)` — intercept every emit (suppress / observe);
 *   returns an unsubscribe function
 * - `clear()` — remove all handlers (also clears registered middleware)
 */
export class EventBus {
  private handlers = new Map<string, Set<BusEventHandler<never>>>();
  private middlewares: EmitMiddleware[] = [];
  private emitFailureHandlers: EventEmitFailureHandler[] = [];

  /** Subscribe to a typed event. Returns an unsubscribe function. */
  on<K extends keyof BusEvents>(
    event: K,
    handler: BusEventHandler<BusEvents[K]>,
  ): () => void;
  /** Subscribe to a typed module-declared event. */
  on<E extends ModuleEventDef>(
    event: E,
    handler: BusEventHandler<ModuleEventPayload<E>>,
  ): () => void;
  /** Subscribe to a custom string event. */
  on(event: string, handler: BusEventHandler<Record<string, unknown>>): () => void;
  /** Wildcard: receive every event as a BusEnvelope. */
  on(event: "*", handler: BusEventHandler<BusEnvelope>): () => void;
  on(
    event: string | ModuleEventDef,
    handler: BusEventHandler<never>,
  ): () => void {
    const name = typeof event === "string" ? event : event.name;
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(handler);
    return () => this.off(name, handler);
  }

  /** Unsubscribe a handler from an event. */
  off(event: string, handler: BusEventHandler<never>): void {
    const set = this.handlers.get(event);
    if (!set) return;
    set.delete(handler);
    if (set.size === 0) this.handlers.delete(event);
  }

  /** Subscribe to an event, auto-unsubscribe after the first call. */
  once<K extends keyof BusEvents>(
    event: K,
    handler: BusEventHandler<BusEvents[K]>,
  ): () => void;
  once<E extends ModuleEventDef>(
    event: E,
    handler: BusEventHandler<ModuleEventPayload<E>>,
  ): () => void;
  once(event: string, handler: BusEventHandler<Record<string, unknown>>): () => void;
  once(
    event: string | ModuleEventDef,
    handler: BusEventHandler<never>,
  ): () => void {
    const name = typeof event === "string" ? event : event.name;
    const wrapper = ((payload: never) => {
      this.off(name, wrapper);
      handler(payload);
    }) as BusEventHandler<never>;
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set();
      this.handlers.set(name, set);
    }
    set.add(wrapper);
    return () => this.off(name, wrapper);
  }

  /**
   * Register an emit-middleware. Fires for every subsequent emit in
   * registration order. Returns an unsubscribe function that removes the
   * middleware; safe to call more than once.
   */
  addEmitMiddleware(middleware: EmitMiddleware): () => void {
    this.middlewares.push(middleware);
    return () => {
      const idx = this.middlewares.indexOf(middleware);
      if (idx >= 0) this.middlewares.splice(idx, 1);
    };
  }

  addEmitFailureHandler(handler: EventEmitFailureHandler): () => void {
    this.emitFailureHandlers.push(handler);
    return () => {
      const idx = this.emitFailureHandlers.indexOf(handler);
      if (idx >= 0) this.emitFailureHandlers.splice(idx, 1);
    };
  }

  /** Emit a typed event synchronously to all subscribers + wildcard listeners. */
  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void;
  /** Emit a typed module-declared event. */
  emit<E extends ModuleEventDef>(event: E, payload: ModuleEventPayload<E>): void;
  /** Emit a custom string event. */
  emit(event: string, payload: Record<string, unknown>): void;
  emit(
    event: string | ModuleEventDef,
    payload: Record<string, unknown>,
  ): void {
    const schemaRef = resolveEventSchemaReference(event);
    const name = typeof event === "string" ? event : event.name;
    const envelope: BusEnvelope = { type: name, schemaRef, payload };
    try {
      if (typeof event !== "string") {
        assertModuleEventPayload(event, payload as ModuleEventPayloadObject);
      } else {
        const registered = getModuleEventRegistry()?.get(event);
        if (registered) {
          assertModuleEventPayload(
            {
              name: registered.name,
              fields: registered.fields,
              scope: registered.scope,
              schema: {
                currentVersion: registered.currentVersion,
                payload: registered.payloadSchema,
              },
              filterablePaths: registered.filterablePaths,
              sensitivity: registered.sensitivity,
              compatibility: registered.compatibility,
              examples: registered.examples,
            },
            payload as ModuleEventPayloadObject,
          );
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.notifyEmitFailure({ event: name, schemaRef, envelope, payload, error: err, stage: "validation" });
      throw err;
    }

    if (this.middlewares.length === 0) {
      try {
        this.fanOut(envelope);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.notifyEmitFailure({ event: name, schemaRef, envelope, payload, error: err, stage: "fanout" });
        throw err;
      }
      return;
    }

    const chain = this.middlewares.slice();
    let i = 0;
    let failureStage: EventEmitFailureStage = "middleware";
    const next = (): void => {
      if (i >= chain.length) {
        failureStage = "fanout";
        this.fanOut(envelope);
        return;
      }
      failureStage = "middleware";
      const mw = chain[i++]!;
      mw(envelope, next);
    };
    try {
      next();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.notifyEmitFailure({ event: name, schemaRef, envelope, payload, error: err, stage: failureStage });
      throw err;
    }
  }

  private notifyEmitFailure(failure: EventEmitFailure): void {
    for (const handler of this.emitFailureHandlers.slice()) {
      handler(failure);
    }
  }

  private fanOut(envelope: BusEnvelope): void {
    const { type: name, payload } = envelope;
    const set = this.handlers.get(name);
    if (set) {
      for (const handler of set) {
        (handler as BusEventHandler<Record<string, unknown>>)(payload);
      }
    }
    // Wildcard listeners
    if (name !== "*") {
      const wildcardSet = this.handlers.get("*");
      if (wildcardSet) {
        for (const handler of wildcardSet) {
          (handler as BusEventHandler<BusEnvelope>)(envelope);
        }
      }
    }
  }

  /** Remove all handlers and registered middleware. */
  clear(): void {
    this.handlers.clear();
    this.middlewares = [];
    this.emitFailureHandlers = [];
  }

  /** Number of listeners for a given event (or all events if omitted). */
  listenerCount(event?: string): number {
    if (event) return this.handlers.get(event)?.size ?? 0;
    let total = 0;
    for (const set of this.handlers.values()) total += set.size;
    return total;
  }
}

// --- Singleton ---

let instance: EventBus | undefined;

/** Initialize the event bus singleton. Idempotent. */
export function initEventBus(): EventBus {
  if (!instance) instance = new EventBus();
  return instance;
}

/** Get the event bus if initialized, or null. */
export function getEventBus(): EventBus | null {
  return instance ?? null;
}

/** Reset the singleton (for testing). Clears all handlers. */
export function resetEventBus(): void {
  if (instance) instance.clear();
  instance = undefined;
}

/**
 * Emit an event on the bus if it's initialized. No-op otherwise.
 * Convenience for modules that want to emit without checking initialization.
 */
export function tryEmit<K extends keyof BusEvents>(
  event: K,
  payload: BusEvents[K],
): void;
export function tryEmit<E extends ModuleEventDef>(
  event: E,
  payload: ModuleEventPayload<E>,
): void;
export function tryEmit(event: string | ModuleEventDef, payload: unknown): void {
  if (!instance) return;
  const recordPayload = payload as Record<string, unknown>;
  if (typeof event === "string") {
    instance.emit(event, recordPayload);
  } else {
    instance.emit(event, recordPayload);
  }
}
