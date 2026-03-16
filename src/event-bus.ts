/**
 * EventBus — internal pub/sub for cross-module coordination.
 *
 * Typed events let modules react to each other without direct coupling.
 * Ephemeral: no persistence, no replay. Singleton pattern like Scheduler
 * and TaskStore.
 *
 * Used by: AgentSession (session lifecycle), ActionExecutor (action lifecycle),
 * Scheduler (schedule fires). Foundation for daemon mode and event-based triggers.
 */

/** Known event payloads. Extend this map to add new typed events. */
export type BusEvents = {
  "session.start": { sessionId: string; label?: string };
  "session.end": {
    sessionId: string;
    label?: string;
    error?: string;
    durationMs: number;
  };
  "schedule.fire": {
    itemId: number;
    description: string;
    action?: string;
  };
  "action.start": { itemId: number; description: string };
  "action.complete": {
    itemId: number;
    error?: string;
    durationMs: number;
  };
};

/** An event as seen by wildcard listeners: type + payload. */
export type BusEnvelope<K extends string = string> = {
  type: K;
  payload: K extends keyof BusEvents ? BusEvents[K] : Record<string, unknown>;
};

export type BusEventHandler<T = Record<string, unknown>> = (payload: T) => void;

/**
 * Typed event bus. Supports:
 * - `on(event, handler)` — subscribe, returns unsubscribe fn
 * - `once(event, handler)` — auto-unsubscribe after first call
 * - `emit(event, payload)` — synchronous fan-out to all handlers
 * - `on("*", handler)` — wildcard: receives BusEnvelope for every event
 * - `off(event, handler)` — explicit unsubscribe
 * - `clear()` — remove all handlers
 */
export class EventBus {
  private handlers = new Map<string, Set<BusEventHandler<never>>>();

  /** Subscribe to a typed event. Returns an unsubscribe function. */
  on<K extends keyof BusEvents>(
    event: K,
    handler: BusEventHandler<BusEvents[K]>,
  ): () => void;
  /** Subscribe to a custom string event. */
  on(event: string, handler: BusEventHandler<Record<string, unknown>>): () => void;
  /** Wildcard: receive every event as a BusEnvelope. */
  on(event: "*", handler: BusEventHandler<BusEnvelope>): () => void;
  on(event: string, handler: BusEventHandler<never>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
    return () => this.off(event, handler);
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
  once(event: string, handler: BusEventHandler<Record<string, unknown>>): () => void;
  once(event: string, handler: BusEventHandler<never>): () => void {
    const wrapper = ((payload: never) => {
      this.off(event, wrapper);
      handler(payload);
    }) as BusEventHandler<never>;
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(wrapper);
    return () => this.off(event, wrapper);
  }

  /** Emit a typed event synchronously to all subscribers + wildcard listeners. */
  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void;
  /** Emit a custom string event. */
  emit(event: string, payload: Record<string, unknown>): void;
  emit(event: string, payload: Record<string, unknown>): void {
    const set = this.handlers.get(event);
    if (set) {
      for (const handler of set) {
        (handler as BusEventHandler<Record<string, unknown>>)(payload);
      }
    }
    // Wildcard listeners
    if (event !== "*") {
      const wildcardSet = this.handlers.get("*");
      if (wildcardSet) {
        const envelope: BusEnvelope = { type: event, payload };
        for (const handler of wildcardSet) {
          (handler as BusEventHandler<BusEnvelope>)(envelope);
        }
      }
    }
  }

  /** Remove all handlers. */
  clear(): void {
    this.handlers.clear();
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
): void {
  instance?.emit(event, payload);
}
