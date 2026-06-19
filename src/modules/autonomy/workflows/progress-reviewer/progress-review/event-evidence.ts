import type { WorkflowRunTrigger } from "#core/workflow/trigger-types.js";
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

export function listBatchEvents(
  source: ProgressReviewDirectorySource,
  trigger: WorkflowRunTrigger,
  excluded: string[],
): ProgressReviewEventEvidence[] {
  const batch = batchPayload(trigger);
  if (!batch) return [];
  const events = batch.inputEvents
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
  if (events.length > PROGRESS_REVIEW_MAX_EVENTS) {
    excluded.push(
      `batch events: truncated ${events.length} input events to ${PROGRESS_REVIEW_MAX_EVENTS}`,
    );
  }
  return events.slice(0, PROGRESS_REVIEW_MAX_EVENTS).map(({ event, index }) => ({
    id: sourceEvidenceId(source, `event:${index + 1}`),
    kind: "event",
    event: event.event,
    receivedAt: event.receivedAt,
    summary: sourceSummary(
      source,
      `${event.event} at ${event.receivedAt}: ${summarizePayload(event.payload)}`,
    ),
  }));
}
