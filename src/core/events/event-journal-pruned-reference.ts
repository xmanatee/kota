import {
  buildEvidencePrunedReference,
  type EvidenceJsonObject,
  type EvidencePrunedReference,
} from "#core/evidence/policy.js";
import type {
  EventEnvelope,
  EventEnvelopeScope,
} from "./event-journal.js";

function retainedScopeMetadata(scope: EventEnvelopeScope): EvidenceJsonObject {
  if (scope.kind === "daemon") return { scopeKind: "daemon" };
  return {
    scopeKind: "scope",
    scopeId: scope.scopeId,
    projectId: scope.projectId,
    lineage: [...scope.lineage],
  };
}

export function eventPrunedReference(
  envelope: EventEnvelope,
): EvidencePrunedReference {
  const producer = envelope.producer;
  const sourceEventIds =
    envelope.causality.parentEventId !== undefined ? [envelope.causality.parentEventId] : [];
  return buildEvidencePrunedReference({
    artifactType: "event-envelope",
    id: envelope.id,
    prunedAt:
      envelope.retention.kind === "expires"
        ? envelope.retention.expiresAt
        : envelope.timestamps.journaledAt,
    retained: {
      id: envelope.id,
      event: envelope.event.name,
      state: "active",
      sequence: envelope.sequence,
      occurredAt: envelope.timestamps.occurredAt,
      receivedAt: envelope.timestamps.receivedAt,
      emittedAt: envelope.timestamps.emittedAt,
      journaledAt: envelope.timestamps.journaledAt,
      ...retainedScopeMetadata(envelope.scope),
      sourceKind: envelope.source.kind,
      sourceId: envelope.source.id,
      producerKind: producer.kind,
    },
    provenance: {
      ...(producer.kind === "module" ? { producerModule: producer.module } : {}),
      ...(producer.kind === "workflow"
        ? {
            workflowName: producer.workflow,
            runId: producer.runId,
            ...(producer.stepId !== undefined ? { stepId: producer.stepId } : {}),
          }
        : {}),
      sourceEventIds,
      transformedFrom: sourceEventIds.map((id) => ({
        artifactType: "event-envelope" as const,
        id,
      })),
    },
  });
}
