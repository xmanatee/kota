import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type EventEnvelope,
  EventJournal,
  type EventJournalClientProjection,
} from "#core/events/event-journal.js";
import type {
  WorkflowBatchFlushPayload,
  WorkflowRunTrigger,
} from "#core/workflow/trigger-types.js";
import { PROGRESS_REVIEW_MAX_EVENTS } from "./constants.js";
import {
  batchPayload,
  eventScopeId,
  sourceEvidenceId,
  sourceSummary,
  summarizePayload,
} from "./trigger-target.js";
import type {
  ProgressReviewDirectorySource,
  ProgressReviewEventEvidence,
} from "./types.js";

const JOURNAL_BACKFILL_EVENT_NAMES = new Set([
  "workflow.completed",
  "workflow.build.committed",
  "inbound.signal.received",
]);

type BatchInputEvent = WorkflowBatchFlushPayload["inputEvents"][number];

type IndexedBatchEvent = {
  event: BatchInputEvent;
  index: number;
};

type ProgressReviewEventJournalOptions = {
  stateDir: string;
  eventJournal?: EventJournal;
};

function eventEvidenceId(
  source: ProgressReviewDirectorySource,
  event: BatchInputEvent,
  index: number,
): string {
  return sourceEvidenceId(
    source,
    event.eventId ? `event:${event.eventId}` : `event:${index + 1}`,
  );
}

function listScopedBatchInputs(
  source: ProgressReviewDirectorySource,
  trigger: WorkflowRunTrigger,
  excluded: string[],
): IndexedBatchEvent[] {
  const batch = batchPayload(trigger);
  if (!batch) return [];
  return batch.inputEvents
    .map((event, index) => ({ event, index }))
    .filter(({ event, index }) => {
      const scopeId = eventScopeId(event.payload);
      if (scopeId === source.scopeId) return true;
      if (!scopeId && !source.idPrefix) return true;
      if (!scopeId) {
        excluded.push(
          `batch event ${index + 1} ${event.event}: skipped event with unknown scope for global review`,
        );
      }
      return false;
    });
}

function batchEventEvidence(
  source: ProgressReviewDirectorySource,
  input: IndexedBatchEvent,
): ProgressReviewEventEvidence {
  const payloadSummary = summarizePayload(input.event.payload);
  return {
    id: eventEvidenceId(source, input.event, input.index),
    kind: "event",
    event: input.event.event,
    receivedAt: input.event.receivedAt,
    source: "batch",
    ...(input.event.eventId ? { journalId: input.event.eventId } : {}),
    payloadSummary,
    summary: sourceSummary(
      source,
      `${input.event.event} at ${input.event.receivedAt}: ${payloadSummary}`,
    ),
  };
}

function eventJournalDir(stateDir: string): string {
  return join(stateDir, "events");
}

function eventJournalPath(stateDir: string): string {
  return join(eventJournalDir(stateDir), "journal.jsonl");
}

function shouldReportMissingJournal(batch: WorkflowBatchFlushPayload): boolean {
  return batch.batch.droppedInputCount > 0;
}

function shouldBackfillFromJournal(batch: WorkflowBatchFlushPayload): boolean {
  return JOURNAL_BACKFILL_EVENT_NAMES.has(batch.sourceEventName);
}

function journalQueryStartMs(
  windowStartMs: number,
  batch: WorkflowBatchFlushPayload,
): number {
  const firstEventMs = Date.parse(batch.window.firstEventAt);
  if (!Number.isFinite(firstEventMs)) return windowStartMs;
  return Math.max(windowStartMs, firstEventMs - 1);
}

function journalEventEvidence(
  source: ProgressReviewDirectorySource,
  projection: EventJournalClientProjection,
): ProgressReviewEventEvidence {
  const payloadSummary = summarizePayload(projection.payload);
  return {
    id: sourceEvidenceId(source, `event:${projection.id}`),
    kind: "event",
    event: projection.type,
    receivedAt: projection.timestamp,
    source: "journal",
    journalId: projection.id,
    sourceId: projection.source.id,
    payloadSummary,
    summary: sourceSummary(
      source,
      `${projection.type} journal ${projection.id} at ${projection.timestamp}: ${payloadSummary}`,
    ),
  };
}

function listJournalEvents(args: {
  source: ProgressReviewDirectorySource;
  batch: WorkflowBatchFlushPayload;
  windowStartMs: number;
  excluded: string[];
  remainingEventSlots: number;
  liveJournalIds: ReadonlySet<string>;
  journalOptions: ProgressReviewEventJournalOptions;
}): ProgressReviewEventEvidence[] {
  if (!shouldBackfillFromJournal(args.batch)) return [];

  const journalPath = eventJournalPath(args.journalOptions.stateDir);
  if (!args.journalOptions.eventJournal && !existsSync(journalPath)) {
    if (shouldReportMissingJournal(args.batch)) {
      args.excluded.push(
        `event journal: missing ${journalPath}; cannot backfill ${args.batch.batch.droppedInputCount} dropped ${args.batch.sourceEventName} input events`,
      );
    }
    return [];
  }

  if (args.remainingEventSlots <= 0) {
    args.excluded.push(
      `event journal: skipped ${args.batch.sourceEventName} backfill because the ${PROGRESS_REVIEW_MAX_EVENTS} event evidence limit is already full`,
    );
    return [];
  }

  let journal: EventJournal;
  let envelopes: EventEnvelope[];
  try {
    journal =
      args.journalOptions.eventJournal ??
      new EventJournal(eventJournalDir(args.journalOptions.stateDir));
    envelopes = journal.query({
      type: args.batch.sourceEventName,
      scopeId: args.source.scopeId,
      sinceMs: journalQueryStartMs(args.windowStartMs, args.batch),
      limit: args.remainingEventSlots + args.liveJournalIds.size + 1,
    });
  } catch (error) {
    args.excluded.push(
      `event journal: unavailable for ${args.batch.sourceEventName}: ${String(error)}`,
    );
    return [];
  }

  const unseen = envelopes.filter((envelope) => !args.liveJournalIds.has(envelope.id));
  if (unseen.length === 0 && shouldReportMissingJournal(args.batch)) {
    args.excluded.push(
      `event journal: no matching ${args.batch.sourceEventName} entries for scope ${args.source.scopeId}; dropped inputs may be expired or unavailable`,
    );
    return [];
  }

  if (unseen.length > args.remainingEventSlots) {
    args.excluded.push(
      `event journal: truncated ${unseen.length} ${args.batch.sourceEventName} entries to ${args.remainingEventSlots}`,
    );
  }

  return unseen
    .slice(0, args.remainingEventSlots)
    .map((envelope) => journalEventEvidence(args.source, journal.toClientProjection(envelope)));
}

export function listBatchEvents(
  source: ProgressReviewDirectorySource,
  trigger: WorkflowRunTrigger,
  windowStartMs: number,
  excluded: string[],
  journalOptions: ProgressReviewEventJournalOptions,
): ProgressReviewEventEvidence[] {
  const batch = batchPayload(trigger);
  if (!batch) return [];

  const batchInputs = listScopedBatchInputs(source, trigger, excluded);
  if (batchInputs.length > PROGRESS_REVIEW_MAX_EVENTS) {
    excluded.push(
      `batch events: truncated ${batchInputs.length} input events to ${PROGRESS_REVIEW_MAX_EVENTS}`,
    );
  }

  const live = batchInputs
    .slice(0, PROGRESS_REVIEW_MAX_EVENTS)
    .map((input) => batchEventEvidence(source, input));
  const liveJournalIds = new Set(
    live.flatMap((event) => (event.journalId ? [event.journalId] : [])),
  );
  const journalEvents = listJournalEvents({
    source,
    batch,
    windowStartMs,
    excluded,
    remainingEventSlots: PROGRESS_REVIEW_MAX_EVENTS - live.length,
    liveJournalIds,
    journalOptions,
  });

  return [...live, ...journalEvents];
}
