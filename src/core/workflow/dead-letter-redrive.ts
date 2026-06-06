import type {
  DeadLetterEventRedrive,
  DeadLetterItem,
  DeadLetterWorkflowRedrive,
} from "#core/daemon/dead-letter-queue.js";
import type { BusEnvelope } from "#core/events/event-bus.js";
import {
  type EventJournal,
  eventEnvelopeToBusEnvelope,
} from "#core/events/event-journal.js";
import type { WorkflowRunStore } from "./run-store.js";
import type {
  WorkflowBatchFlushPayload,
  WorkflowRunTrigger,
} from "./trigger-types.js";

type RedriveResolution<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

type RedrivePayloadMetadata = {
  redriveOf: string;
  redriveReason: string;
  redriveTriggeredAt: string;
  causationId: string;
  sourceEventIds: string[];
};

export type DeadLetterWorkflowRedriveDeps = {
  runStore: WorkflowRunStore;
  eventJournal?: EventJournal;
  runId: string;
  reason: string;
  nowMs: number;
};

export type DeadLetterEventRedriveDeps = {
  eventJournal?: EventJournal;
  reason: string;
  nowMs: number;
};

export function buildDeadLetterWorkflowTrigger(
  item: DeadLetterItem,
  redrive: DeadLetterWorkflowRedrive,
  deps: DeadLetterWorkflowRedriveDeps,
): RedriveResolution<WorkflowRunTrigger> {
  const resolved = resolveWorkflowSource(redrive, deps);
  if (!resolved.ok) return resolved;
  return {
    ok: true,
    value: withWorkflowRedriveMetadata(
      resolved.value,
      item,
      deps.runId,
      deps.reason,
      deps.nowMs,
      redrive.source.kind === "run-trigger" ? redrive.source.runId : undefined,
    ),
  };
}

export function buildDeadLetterEventEnvelope(
  item: DeadLetterItem,
  redrive: DeadLetterEventRedrive,
  deps: DeadLetterEventRedriveDeps,
): RedriveResolution<BusEnvelope> {
  const event = eventFromJournal(redrive.source.eventId, deps.eventJournal);
  if (!event.ok) return event;
  return {
    ok: true,
    value: {
      ...event.value,
      payload: withRedrivePayloadMetadata(
        event.value.payload,
        item,
        deps.reason,
        deps.nowMs,
      ),
    },
  };
}

function resolveWorkflowSource(
  redrive: DeadLetterWorkflowRedrive,
  deps: DeadLetterWorkflowRedriveDeps,
): RedriveResolution<WorkflowRunTrigger> {
  switch (redrive.source.kind) {
    case "run-trigger": {
      const run = deps.runStore.getRun(redrive.source.runId);
      if (run === null) {
        return {
          ok: false,
          message: `source workflow run "${redrive.source.runId}" is not available`,
        };
      }
      return { ok: true, value: run.trigger };
    }
    case "event-journal": {
      const event = eventFromJournal(redrive.source.eventId, deps.eventJournal);
      if (!event.ok) return event;
      return { ok: true, value: workflowTriggerFromBusEnvelope(event.value) };
    }
    case "batch-event-journal":
      return resolveBatchTrigger(redrive.source, deps.eventJournal);
    case "resume-step":
      return {
        ok: true,
        value: {
          event: "resume",
          schemaRef: null,
          payload: {
            resumedFromRunId: redrive.source.runId,
            resumeFromStep: redrive.source.stepId,
          },
        },
      };
  }
}

function resolveBatchTrigger(
  source: Extract<DeadLetterWorkflowRedrive["source"], { kind: "batch-event-journal" }>,
  eventJournal: EventJournal | undefined,
): RedriveResolution<WorkflowRunTrigger> {
  const inputEvents: WorkflowBatchFlushPayload["inputEvents"] = [];
  for (const input of source.payload.inputEvents) {
    if (input.eventId === undefined) {
      return {
        ok: false,
        message: "batch input event is missing a journal id",
      };
    }
    const event = eventFromJournal(input.eventId, eventJournal);
    if (!event.ok) return event;
    inputEvents.push({
      event: event.value.type,
      schemaRef: event.value.schemaRef,
      ...(event.value.eventId !== undefined ? { eventId: event.value.eventId } : {}),
      receivedAt: input.receivedAt,
      payload: event.value.payload,
    });
  }

  return {
    ok: true,
    value: {
      event: source.triggerEvent,
      schemaRef: source.triggerSchemaRef,
      payload: {
        ...source.payload,
        inputEvents,
      },
    },
  };
}

function eventFromJournal(
  eventId: string,
  eventJournal: EventJournal | undefined,
): RedriveResolution<BusEnvelope> {
  if (eventJournal === undefined) {
    return { ok: false, message: "event journal is not available" };
  }
  const event = eventJournal.query({ id: eventId })[0];
  if (event === undefined) {
    return {
      ok: false,
      message: `event journal entry "${eventId}" is not available`,
    };
  }
  return { ok: true, value: eventEnvelopeToBusEnvelope(event) };
}

function workflowTriggerFromBusEnvelope(envelope: BusEnvelope): WorkflowRunTrigger {
  return {
    event: envelope.type,
    schemaRef: envelope.schemaRef,
    ...(envelope.eventId !== undefined ? { eventId: envelope.eventId } : {}),
    payload: envelope.payload,
  };
}

function withWorkflowRedriveMetadata(
  trigger: WorkflowRunTrigger,
  item: DeadLetterItem,
  runId: string,
  reason: string,
  nowMs: number,
  retryOf: string | undefined,
): WorkflowRunTrigger {
  return {
    event: trigger.event,
    schemaRef: trigger.schemaRef,
    ...(trigger.eventId !== undefined ? { eventId: trigger.eventId } : {}),
    payload: {
      ...trigger.payload,
      _runId: runId,
      ...(retryOf !== undefined ? { retryOf } : {}),
      ...redrivePayloadMetadata(item, reason, nowMs),
    },
  };
}

function withRedrivePayloadMetadata(
  payload: BusEnvelope["payload"],
  item: DeadLetterItem,
  reason: string,
  nowMs: number,
): BusEnvelope["payload"] {
  return {
    ...payload,
    ...redrivePayloadMetadata(item, reason, nowMs),
  };
}

function redrivePayloadMetadata(
  item: DeadLetterItem,
  reason: string,
  nowMs: number,
): RedrivePayloadMetadata {
  return {
    redriveOf: item.id,
    redriveReason: reason,
    redriveTriggeredAt: new Date(nowMs).toISOString(),
    causationId: item.id,
    sourceEventIds: item.sourceEventIds,
  };
}
