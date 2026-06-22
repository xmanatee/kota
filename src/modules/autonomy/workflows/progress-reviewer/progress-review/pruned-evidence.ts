import type { EvidencePrunedReference } from "#core/evidence/policy.js";
import {
  EVIDENCE_PRUNED_REASON_CODE,
  type EvidenceProvenanceExpectation,
  type EvidenceRetainedValueExpectation,
  validateEvidencePrunedReference,
} from "#core/evidence/pruned-reference.js";
import type {
  ProgressReviewEventEvidence,
  ProgressReviewEvidenceRef,
  ProgressReviewPrunedEvidenceReference,
  ProgressReviewRunEvidence,
} from "./types.js";

function expectedRetainedKeys(
  reference: ProgressReviewPrunedEvidenceReference,
): readonly string[] {
  switch (reference.artifactType) {
    case "event-envelope":
      return ["id", "event", "state", "receivedAt", "journaledAt"];
    case "workflow-run":
      return ["id", "workflow", "status", "startedAt"];
    default:
      return ["id"];
  }
}

function evidenceIdMatchesPrunedReference(
  evidence: ProgressReviewEvidenceRef,
  reference: ProgressReviewPrunedEvidenceReference,
): boolean {
  if (reference.artifactType === "event-envelope") {
    return evidence.kind === "event" && evidence.id.endsWith(`event:${reference.id}`);
  }
  if (reference.artifactType === "workflow-run") {
    return evidence.kind === "run" && evidence.id.endsWith(`run:${reference.id}`);
  }
  return evidence.id.endsWith(reference.id);
}

function evidenceIdSuffix(evidenceId: string, marker: string): string | null {
  const markerIndex = evidenceId.lastIndexOf(marker);
  if (markerIndex < 0) return null;
  const suffix = evidenceId.slice(markerIndex + marker.length);
  return suffix.length > 0 ? suffix : null;
}

function isProgressReviewRunEvidence(
  evidence: ProgressReviewEvidenceRef,
): evidence is ProgressReviewRunEvidence {
  const run = evidence as Partial<ProgressReviewRunEvidence>;
  return evidence.kind === "run" &&
    typeof run.workflow === "string" &&
    typeof run.status === "string" &&
    typeof run.startedAt === "string";
}

function isProgressReviewEventEvidence(
  evidence: ProgressReviewEvidenceRef,
): evidence is ProgressReviewEventEvidence {
  const event = evidence as Partial<ProgressReviewEventEvidence>;
  return evidence.kind === "event" &&
    typeof event.event === "string" &&
    typeof event.receivedAt === "string";
}

function expectedReferenceId(
  evidence: ProgressReviewEvidenceRef,
  reference: ProgressReviewPrunedEvidenceReference,
): string | null {
  if (reference.artifactType === "event-envelope") {
    if (evidence.kind !== "event") return null;
    return isProgressReviewEventEvidence(evidence) && evidence.journalId
      ? evidence.journalId
      : evidenceIdSuffix(evidence.id, "event:");
  }
  if (reference.artifactType === "workflow-run") {
    if (evidence.kind !== "run") return null;
    return evidenceIdSuffix(evidence.id, "run:");
  }
  return evidence.id.endsWith(reference.id) ? reference.id : null;
}

function expectedRetainedValues(
  evidence: ProgressReviewEvidenceRef,
  referenceId: string,
): EvidenceRetainedValueExpectation[] {
  if (isProgressReviewEventEvidence(evidence)) {
    const values: EvidenceRetainedValueExpectation[] = [
      { key: "id", value: referenceId },
      { key: "event", value: evidence.event },
      { key: "receivedAt", value: evidence.receivedAt },
    ];
    if (evidence.sourceId !== undefined) {
      values.push({ key: "sourceId", value: evidence.sourceId });
    }
    return values;
  }
  if (isProgressReviewRunEvidence(evidence)) {
    const values: EvidenceRetainedValueExpectation[] = [
      { key: "id", value: referenceId },
      { key: "workflow", value: evidence.workflow },
      { key: "status", value: evidence.status },
      { key: "startedAt", value: evidence.startedAt },
    ];
    if (evidence.completedAt !== undefined) {
      values.push({ key: "completedAt", value: evidence.completedAt });
    }
    return values;
  }
  return [{ key: "id", value: referenceId }];
}

function retainedDateTimeKeys(reference: ProgressReviewPrunedEvidenceReference): readonly string[] {
  switch (reference.artifactType) {
    case "event-envelope":
      return ["occurredAt", "receivedAt", "emittedAt", "journaledAt"];
    case "workflow-run":
      return ["startedAt", "completedAt"];
    default:
      return [];
  }
}

function expectedProvenance(
  evidence: ProgressReviewEvidenceRef,
  referenceId: string,
): EvidenceProvenanceExpectation | undefined {
  if (!isProgressReviewRunEvidence(evidence)) return undefined;
  return {
    workflowName: evidence.workflow,
    runId: referenceId,
  };
}

export function progressReviewPrunedReference(
  reference: EvidencePrunedReference,
  retainedKeys: readonly string[],
): ProgressReviewPrunedEvidenceReference {
  const validation = validateEvidencePrunedReference(reference, {
    artifactType: reference.artifactType,
    id: reference.id,
    retainedKeys,
  });
  if (!validation.ok) {
    throw new Error(`invalid pruned evidence reference: ${validation.reason}`);
  }
  return {
    reasonCode: EVIDENCE_PRUNED_REASON_CODE,
    artifactType: reference.artifactType,
    id: reference.id,
    prunedAt: reference.prunedAt,
    retained: reference.retained,
    provenance: reference.provenance,
  };
}

export function assertProgressReviewPrunedEvidenceRef(
  evidence: ProgressReviewEvidenceRef,
): void {
  if (!evidence.pruned) return;
  if (evidence.pruned.reasonCode !== EVIDENCE_PRUNED_REASON_CODE) {
    throw new Error(
      `progress-review pruned evidence ${evidence.id} has unsupported reasonCode ${evidence.pruned.reasonCode}`,
    );
  }
  const referenceId = expectedReferenceId(evidence, evidence.pruned);
  if (referenceId === null || !evidenceIdMatchesPrunedReference(evidence, evidence.pruned)) {
    throw new Error(
      `progress-review pruned evidence ${evidence.id} does not match retained id ${evidence.pruned.id}`,
    );
  }
  const validation = validateEvidencePrunedReference(
    {
      artifactType: evidence.pruned.artifactType,
      id: evidence.pruned.id,
      prunedAt: evidence.pruned.prunedAt,
      retained: evidence.pruned.retained,
      provenance: evidence.pruned.provenance,
      payloadExpired: true,
    },
    {
      artifactType: evidence.pruned.artifactType,
      id: referenceId,
      retainedKeys: expectedRetainedKeys(evidence.pruned),
      retainedValues: expectedRetainedValues(evidence, referenceId),
      retainedDateTimeKeys: retainedDateTimeKeys(evidence.pruned),
      provenance: expectedProvenance(evidence, referenceId),
    },
  );
  if (!validation.ok) {
    throw new Error(
      `progress-review pruned evidence ${evidence.id} is malformed: ${validation.reason}`,
    );
  }
  if (evidence.pruned.id !== referenceId) {
    throw new Error(
      `progress-review pruned evidence ${evidence.id} does not match retained id ${evidence.pruned.id}`,
    );
  }
}
