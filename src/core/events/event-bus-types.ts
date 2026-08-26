import type { RuntimeBusEvents } from "./event-bus-runtime-events.js";
import type { TailBusEvents } from "./event-bus-tail-events.js";

/** JSON-shaped extension fields are narrowed at event boundary consumers. */
export type EventPayloadRecord = Record<string, unknown>;

export type {
  BusEnvelope,
  BusEventHandler,
  EventSchemaReference,
  ScopedBusEventName,
  ScopedBusEventPayload,
} from "./event-bus-envelope-types.js";
export type {
  DaemonConfigReloadEvent,
  GuardrailsNonRefreshableSession,
  ScopeLifecycleBlockerKind,
  ScopeLifecycleEvent,
  SessionGuardrailsReloadSummary,
} from "./event-bus-lifecycle-types.js";

export type BusEvents = RuntimeBusEvents & TailBusEvents;
