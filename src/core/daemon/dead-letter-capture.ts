import type {
  BusEnvelope,
  EventSchemaReference,
} from "#core/events/event-bus.js";
import {
  type EventEnvelope,
  type EventJsonObject,
  redactedPayloadForClient,
} from "#core/events/event-journal.js";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type {
  WorkflowBatchFlushPayload,
  WorkflowRunTrigger,
} from "#core/workflow/trigger-types.js";
import { redactDeadLetterJson, toEventJsonObject } from "./dead-letter-policy.js";
import type {
  DeadLetterFailureClass,
  DeadLetterItem,
  DeadLetterWorkflowRedrive,
  DeadLetterWorkflowRedriveSource,
} from "./dead-letter-queue.js";
import type { DeadLetterQueueStore } from "./dead-letter-store.js";

function workflowTriggerProjection(
  workflowName: string,
  trigger: WorkflowRunTrigger,
): EventJsonObject {
  return redactDeadLetterJson(
    toEventJsonObject({
      workflowName,
      triggerEvent: trigger.event,
      triggerSchemaRef: trigger.schemaRef,
      triggerPayload: trigger.payload,
    }),
  );
}

function sourceEventIdsFromTrigger(trigger: WorkflowRunTrigger): string[] {
  const ids = new Set<string>();
  if (trigger.eventId !== undefined) ids.add(trigger.eventId);
  const payloadEventId = trigger.payload.eventId;
  if (typeof payloadEventId === "string" && payloadEventId.length > 0) {
    ids.add(payloadEventId);
  }
  const inputEvents = trigger.payload.inputEvents;
  if (Array.isArray(inputEvents)) {
    for (const item of inputEvents) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const eventId = "eventId" in item ? item.eventId : undefined;
      if (typeof eventId === "string" && eventId.length > 0) ids.add(eventId);
    }
  }
  return [...ids];
}

function sourceEventIdsFromBatch(payload: WorkflowBatchFlushPayload): string[] {
  return payload.inputEvents.flatMap((event) =>
    event.eventId !== undefined ? [event.eventId] : [],
  );
}

function workflowRedrive(
  workflowName: string,
  source: DeadLetterWorkflowRedriveSource,
): DeadLetterWorkflowRedrive {
  return { kind: "workflow", workflowName, source };
}

export function createWorkflowDispatchDeadLetter(input: {
  store: DeadLetterQueueStore;
  scopeId: string;
  workflowName: string;
  trigger: WorkflowRunTrigger;
  reason: string;
  errorClass: DeadLetterFailureClass;
  failedRun?: WorkflowRunMetadata;
  retryCount?: number;
  backoffUntil?: string;
  owningModule?: string;
}): DeadLetterItem {
  const projection = workflowTriggerProjection(input.workflowName, input.trigger);
  const failedRunId = input.failedRun?.id;
  const redrive = failedRunId !== undefined
    ? workflowRedrive(input.workflowName, { kind: "run-trigger", runId: failedRunId })
    : input.trigger.eventId !== undefined
    ? workflowRedrive(input.workflowName, {
      kind: "event-journal",
      eventId: input.trigger.eventId,
    })
    : {
      kind: "none" as const,
      reason: "workflow dispatch redrive requires a failed run or journaled trigger event",
    };
  return input.store.record({
    type: "workflow-dispatch",
    scopeId: input.scopeId,
    owningModule: input.owningModule ?? "workflow-runtime",
    sourceEventIds: sourceEventIdsFromTrigger(input.trigger),
    affectedWorkflowNames: [input.workflowName],
    failure: {
      reason: input.reason,
      retryCount: input.retryCount,
      lastErrorClass: input.errorClass,
      failedAt: input.failedRun?.completedAt,
      ...(input.backoffUntil === undefined
        ? {}
        : { backoffUntil: input.backoffUntil }),
    },
    source: {
      kind: "workflow-dispatch",
      workflowName: input.workflowName,
      triggerEvent: input.trigger.event,
      triggerSchemaRef: input.trigger.schemaRef,
      ...(failedRunId !== undefined ? { failedRunId } : {}),
      ...(input.failedRun?.runDir !== undefined ? { runDir: input.failedRun.runDir } : {}),
    },
    redrive,
    redactedProjection: projection,
  });
}

export function createBatchDeadLetter(input: {
  store: DeadLetterQueueStore;
  scopeId: string;
  payload: WorkflowBatchFlushPayload;
  reason: string;
  errorClass: DeadLetterFailureClass;
  trigger: WorkflowRunTrigger;
}): DeadLetterItem {
  const inputEvents = input.payload.inputEvents.map((event) => ({
    event: event.event,
    schemaRef: event.schemaRef,
    ...(event.eventId !== undefined ? { eventId: event.eventId } : {}),
    receivedAt: event.receivedAt,
  }));
  const everyInputEventJournaled = inputEvents.every((event) => event.eventId !== undefined);
  return input.store.record({
    type: "batch-envelope",
    scopeId: input.scopeId,
    owningModule: "workflow-runtime",
    sourceEventIds: sourceEventIdsFromBatch(input.payload),
    affectedWorkflowNames: [input.payload.batch.workflow],
    failure: { reason: input.reason, lastErrorClass: input.errorClass },
    source: {
      kind: "batch-envelope",
      workflowName: input.payload.batch.workflow,
      triggerIndex: input.payload.batch.triggerIndex,
      sourceEventName: input.payload.sourceEventName,
      groupingKey: input.payload.groupingKey,
      inputEventCount: input.payload.inputEvents.length,
      droppedInputCount: input.payload.batch.droppedInputCount,
    },
    redrive: everyInputEventJournaled
      ? workflowRedrive(input.payload.batch.workflow, {
          kind: "batch-event-journal",
          triggerEvent: input.trigger.event,
          triggerSchemaRef: input.trigger.schemaRef,
          payload: {
            scopeId: input.payload.scopeId,
            sourceEventName: input.payload.sourceEventName,
            groupingKey: input.payload.groupingKey,
            reason: input.payload.reason,
            count: input.payload.count,
            window: input.payload.window,
            inputEvents,
            batch: input.payload.batch,
          },
        })
      : {
          kind: "none",
          reason: "batch redrive requires every input event to have a journal id",
        },
    redactedProjection: redactDeadLetterJson(toEventJsonObject(input.payload)),
  });
}

type EventEnvelopeDeadLetterInputBase = {
  store: DeadLetterQueueStore;
  scopeId: string;
  reason: string;
  errorClass: DeadLetterFailureClass;
  redriveEnvelope?: BusEnvelope;
  owningModule?: string;
};

type JournaledEventEnvelopeDeadLetterInput = EventEnvelopeDeadLetterInputBase & {
  envelope: EventEnvelope;
};

type UnjournaledEventEnvelopeDeadLetterInput = EventEnvelopeDeadLetterInputBase & {
  eventName: string;
  schemaRef: EventSchemaReference | null;
  payload: BusEnvelope["payload"];
};

export function createEventEnvelopeDeadLetter(
  input: JournaledEventEnvelopeDeadLetterInput | UnjournaledEventEnvelopeDeadLetterInput,
): DeadLetterItem {
  const journaled = "envelope" in input;
  const eventName = journaled ? input.envelope.event.name : input.eventName;
  const eventJournalId = journaled ? input.envelope.id : undefined;
  const redriveEventId = eventJournalId ?? input.redriveEnvelope?.eventId;
  return input.store.record({
    type: "event-envelope",
    scopeId: input.scopeId,
    owningModule: input.owningModule ?? "event-runtime",
    sourceEventIds: eventJournalId !== undefined ? [eventJournalId] : [],
    affectedWorkflowNames: [],
    failure: { reason: input.reason, lastErrorClass: input.errorClass },
    source: {
      kind: "event-envelope",
      eventName,
      ...(eventJournalId !== undefined ? { eventJournalId } : {}),
    },
    redrive: redriveEventId !== undefined
      ? { kind: "event", source: { kind: "event-journal", eventId: redriveEventId } }
      : { kind: "none", reason: "event redrive requires the event journal" },
    redactedProjection: journaled
      ? redactedPayloadForClient(input.envelope)
      : redactDeadLetterJson(toEventJsonObject(input.payload)),
  });
}

export function createConfirmedActionDeadLetter(input: {
  store: DeadLetterQueueStore;
  scopeId: string;
  decisionId: string;
  actionId: string;
  adapterName: string;
  reason: string;
  workflowName?: string;
  runId?: string;
  stepId?: string;
  redactedInput: EventJsonObject;
}): DeadLetterItem {
  const affected = input.workflowName !== undefined ? [input.workflowName] : [];
  const redrive = input.workflowName !== undefined &&
      input.runId !== undefined &&
      input.stepId !== undefined
    ? workflowRedrive(input.workflowName, {
        kind: "resume-step",
        runId: input.runId,
        stepId: input.stepId,
      })
    : {
        kind: "none" as const,
        reason: "confirmed action redrive requires source workflow run and step ids",
      };
  return input.store.record({
    type: "confirmed-action-dispatch",
    scopeId: input.scopeId,
    owningModule: input.adapterName,
    sourceEventIds: [],
    affectedWorkflowNames: affected,
    failure: { reason: input.reason, lastErrorClass: "execution" },
    source: {
      kind: "confirmed-action-dispatch",
      decisionId: input.decisionId,
      actionId: input.actionId,
      adapterName: input.adapterName,
      ...(input.workflowName !== undefined ? { workflowName: input.workflowName } : {}),
      ...(input.runId !== undefined ? { runId: input.runId } : {}),
      ...(input.stepId !== undefined ? { stepId: input.stepId } : {}),
    },
    redrive,
    redactedProjection: redactDeadLetterJson(input.redactedInput),
  });
}
