import type {
  BusEnvelope,
  EventSchemaReference,
} from "#core/events/event-bus.js";
import {
  type EventEnvelope,
  type EventJsonObject,
  eventEnvelopeToBusEnvelope,
} from "#core/events/event-journal.js";
import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
import { eventJournalForProject } from "../utils.js";
import type {
  WorkflowSimulationJournalSelector,
  WorkflowSimulationRequest,
  WorkflowSimulationSource,
} from "./types.js";

export type SimulationEvent = {
  source: WorkflowSimulationSource;
  event: string;
  payload: WorkflowRunTrigger["payload"];
  eventId?: string;
  schemaRef?: EventSchemaReference | null;
  envelope?: EventEnvelope;
};

function isPayload(
  value: WorkflowSimulationRequest["payload"],
): value is WorkflowRunTrigger["payload"] {
  return value !== undefined && value !== null && typeof value === "object" && !Array.isArray(value);
}

function requestPayload(request: WorkflowSimulationRequest): WorkflowRunTrigger["payload"] {
  return isPayload(request.payload) ? request.payload : {};
}

export function eventFromEnvelope(
  envelope: EventEnvelope,
  source: WorkflowSimulationSource,
): SimulationEvent {
  const bus = eventEnvelopeToBusEnvelope(envelope);
  return {
    source,
    event: bus.type,
    payload: bus.payload as WorkflowRunTrigger["payload"],
    eventId: envelope.id,
    schemaRef: bus.schemaRef,
    envelope,
  };
}

function syntheticEvent(request: WorkflowSimulationRequest): SimulationEvent | null {
  if (!request.event) return null;
  return {
    source: { kind: "synthetic" },
    event: request.event,
    payload: requestPayload(request),
    ...(request.eventId ? { eventId: request.eventId } : {}),
  };
}

export function envelopeForDryRun(event: SimulationEvent): EventEnvelope {
  if (event.envelope) return event.envelope;
  const timestamp = new Date(0).toISOString();
  return {
    id: event.eventId ?? "simulation-event",
    sequence: 0,
    event: {
      name: event.event,
      schema: event.schemaRef ?? { name: event.event, version: 1 },
    },
    source: { kind: "unknown", id: "simulation" },
    scope: { kind: "daemon" },
    timestamps: {
      occurredAt: timestamp,
      receivedAt: timestamp,
      emittedAt: timestamp,
      journaledAt: timestamp,
    },
    producer: { kind: "unknown" },
    causality: {},
    trace: {},
    idempotency: {},
    data: {
      classification: "internal",
      sensitivity: "internal",
      dataClasses: ["operational-metadata"],
      redactionProfile: "plain",
      storageProfile: "internal-storage",
    },
    payload: {
      kind: "inline",
      payload: event.payload as EventJsonObject,
    },
    retention: { kind: "retain" },
  };
}

function journalLimit(selector: WorkflowSimulationJournalSelector): number {
  if (selector.limit === undefined) return selector.id ? 1 : 20;
  return Number.isInteger(selector.limit) && selector.limit > 0
    ? Math.min(selector.limit, 100)
    : 20;
}

function journalEvents(
  projectDir: string,
  selector: WorkflowSimulationJournalSelector,
): SimulationEvent[] {
  const journal = eventJournalForProject(projectDir);
  const events = journal.query({
    id: selector.id,
    after: selector.after,
    type: selector.type,
    typePrefix: selector.typePrefix,
    limit: journalLimit(selector),
  });
  return events.map((envelope) =>
    eventFromEnvelope(envelope, {
      kind: "journal",
      journalId: envelope.id,
    })
  );
}

export function resolveEvents(
  projectDir: string,
  request: WorkflowSimulationRequest,
): SimulationEvent[] {
  if (request.envelope) {
    return [eventFromEnvelope(request.envelope, { kind: "envelope" })];
  }
  if (request.journal) {
    return journalEvents(projectDir, request.journal);
  }
  const synthetic = syntheticEvent(request);
  if (synthetic) return [synthetic];
  throw new Error(
    "workflow simulation requires an event, event envelope, or journal selector",
  );
}

export function workflowRunTriggerForEvent(event: SimulationEvent): WorkflowRunTrigger {
  return {
    event: event.event,
    schemaRef: event.schemaRef ?? null,
    ...(event.eventId ? { eventId: event.eventId } : {}),
    payload: event.payload,
  };
}

export function busEnvelopeForEvent(event: SimulationEvent): BusEnvelope {
  return {
    type: event.event,
    schemaRef: event.schemaRef ?? null,
    ...(event.eventId ? { eventId: event.eventId } : {}),
    payload: event.payload,
  };
}

function payloadString(
  payload: WorkflowRunTrigger["payload"],
  key: string,
): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function defaultScopeIdForEvent(event: SimulationEvent): string {
  const payloadScope = payloadString(event.payload, "scopeId") ??
    payloadString(event.payload, "projectId");
  if (payloadScope !== undefined) return payloadScope;
  if (event.envelope?.scope.kind === "scope") return event.envelope.scope.scopeId;
  return "default";
}

export function eventEnvelopePayloadForFixture(
  envelope: EventEnvelope,
): EventJsonObject {
  const bus = eventEnvelopeToBusEnvelope(envelope);
  return bus.payload as EventJsonObject;
}
