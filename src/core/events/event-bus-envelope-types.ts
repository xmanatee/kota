import type { BusEvents, EventPayloadRecord } from "./event-bus-types.js";
import type { ProjectId } from "./project-scope.js";

/**
 * Set of {@link BusEvents} keys whose payload carries a `projectId`
 * compatibility field — the typed registry of directory-scoped event names.
 * Workflow runtime, daemon stores, queue-shape emitters, etc. emit only these
 * names through the scoped wrapper. Daemon-wide names (`module.*`, `model.*`,
 * `session.*` for now) are intentionally excluded.
 */
export type ProjectScopedBusEventName = {
  [K in keyof BusEvents]: BusEvents[K] extends { projectId: ProjectId } ? K : never;
}[keyof BusEvents];

/** Payload of a directory-scoped BusEvents entry minus injected scope attribution. */
export type ProjectScopedBusEventPayload<K extends ProjectScopedBusEventName> =
  Omit<BusEvents[K], "projectId" | "scopeId">;

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
  /** Stable durable journal id when a journal middleware has written this emit. */
  eventId?: string;
  payload: K extends keyof BusEvents ? BusEvents[K] : EventPayloadRecord;
};

export type BusEventHandler<T = EventPayloadRecord> = (payload: T) => void;
