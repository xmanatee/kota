import type { BusEvents, EventPayloadRecord } from "./event-bus-types.js";
import type { ScopeId } from "./scope.js";

/**
 * Set of {@link BusEvents} keys whose payload carries a `scopeId` field — the
 * typed registry of directory-scoped event names.
 * Workflow runtime, daemon stores, queue-shape emitters, etc. emit only these
 * names through the scoped wrapper. Daemon-wide names (`module.*`, `model.*`,
 * `session.*` for now) are intentionally excluded.
 */
export type ScopedBusEventName = {
  [K in keyof BusEvents]: BusEvents[K] extends { scopeId: ScopeId } ? K : never;
}[keyof BusEvents];

/** Payload of a directory-scoped BusEvents entry minus injected scope attribution. */
export type ScopedBusEventPayload<K extends ScopedBusEventName> =
  Omit<BusEvents[K], "scopeId">;

export type EventSchemaReference = {
  name: string;
  version: number;
};

export function isEventSchemaReference<T>(value: T): value is T & EventSchemaReference {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return (
    "name" in value &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    "version" in value &&
    typeof value.version === "number" &&
    Number.isInteger(value.version) &&
    value.version >= 1
  );
}

/** An event as seen by wildcard listeners: type + payload plus schema identity. */
export type BusEnvelope<K extends string = string> = {
  type: K;
  schemaRef: EventSchemaReference | null;
  /** Stable durable identity assigned by the journal or authoritative outbox. */
  eventId?: string;
  /** Authoritative durable delivery whose eventId must survive redelivery. */
  delivery?: "outbox";
  payload: K extends keyof BusEvents ? BusEvents[K] : EventPayloadRecord;
};

export type BusEventHandler<T = EventPayloadRecord> = (payload: T) => void;
