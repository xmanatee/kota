import type {
  EvidenceArtifactReference,
  EvidenceArtifactType,
  EvidenceJsonObject,
  EvidenceProvenance,
  EvidencePrunedReference,
} from "./policy.js";

export const EVIDENCE_PRUNED_REASON_CODE = "policy-pruned-payload";

export type EvidencePrunedReasonCode = typeof EVIDENCE_PRUNED_REASON_CODE;

export type EvidencePrunedReferenceValidation = { ok: true; reference: EvidencePrunedReference } | {
  ok: false;
  reason: string;
};

export type EvidencePrunedReferenceExpectation = {
  artifactType: EvidenceArtifactType;
  id?: string;
  retainedKeys: readonly string[];
  retainedValues?: readonly EvidenceRetainedValueExpectation[];
  retainedDateTimeKeys?: readonly string[];
  provenance?: EvidenceProvenanceExpectation;
};

export type EvidenceRetainedValueExpectation = {
  key: string;
  value: string;
};

export type EvidenceProvenanceExpectation = {
  workflowName?: string;
  runId?: string;
  sourceEventIds?: readonly string[];
  transformedFrom?: readonly EvidenceArtifactReference[];
};

type RequiredStringResult = { ok: true; value: string } | { ok: false; reason: string };

const WORKFLOW_RUN_STATUSES = new Set([
  "success", "failed", "yielded", "interrupted", "completed-with-warnings", "running",
]);

const EVIDENCE_ARTIFACT_TYPES = new Set<EvidenceArtifactType>([
  "event-envelope",
  "workflow-run",
  "workflow-step",
  "dead-letter-item",
  "owner-decision",
  "approval",
  "setup-status",
  "simulation-report",
  "trace-log",
  "exported-report",
]);

function requiredString(value: string | undefined, field: string): RequiredStringResult {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, reason: `${field} must be a non-empty string` };
  }
  return { ok: true, value };
}

function hasObjectShape(value: object | undefined, field: string): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return `${field} must be an object`;
  }
  return null;
}

function isIsoDateTimeString(value: string): boolean {
  return value.includes("T") && Number.isFinite(Date.parse(value));
}

function dateTimeError(value: string | undefined, field: string): string | null {
  const valueResult = requiredString(value, field);
  if (!valueResult.ok) return valueResult.reason;
  if (!isIsoDateTimeString(valueResult.value)) {
    return `${field} must be an ISO date-time string`;
  }
  return null;
}

function retainedMetadataError(
  retained: EvidenceJsonObject | undefined,
  referenceId: string,
  expected: EvidencePrunedReferenceExpectation,
): string | null {
  if (retained === undefined) return "retained must be an object";
  const shapeError = hasObjectShape(retained, "retained");
  if (shapeError) return shapeError;
  for (const key of expected.retainedKeys) {
    const value = retained[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      return `retained.${key} must be a non-empty string`;
    }
  }
  if (retained.id !== referenceId) {
    return `retained.id ${String(retained.id)} does not match reference id ${referenceId}`;
  }
  for (const expectation of expected.retainedValues ?? []) {
    if (retained[expectation.key] !== expectation.value) {
      return `retained.${expectation.key} ${String(retained[expectation.key])} does not match expected ${expectation.value}`;
    }
  }
  for (const key of expected.retainedDateTimeKeys ?? []) {
    const value = retained[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || !isIsoDateTimeString(value)) {
      return `retained.${key} must be an ISO date-time string`;
    }
  }
  return artifactRetainedMetadataError(expected.artifactType, retained);
}

function artifactRetainedMetadataError(
  artifactType: EvidenceArtifactType,
  retained: EvidenceJsonObject,
): string | null {
  if (artifactType === "event-envelope") {
    if (retained?.state !== "active") {
      return `retained.state ${String(retained?.state)} does not match expected active`;
    }
    const scopeKind = retained.scopeKind;
    if (scopeKind !== "daemon" && scopeKind !== "scope") {
      return "retained.scopeKind must be daemon or scope";
    }
    if (scopeKind === "scope") {
      const scopeId = retained.scopeId;
      const projectId = retained.projectId;
      if (typeof scopeId !== "string" || scopeId.trim().length === 0) {
        return "retained.scopeId must be a non-empty string for scope events";
      }
      if (projectId !== scopeId) {
        return `retained.projectId ${String(projectId)} does not match retained.scopeId ${scopeId}`;
      }
      const lineage = retained.lineage;
      if (!Array.isArray(lineage) || !lineage.every((entry) => typeof entry === "string")) {
        return "retained.lineage must be an array of strings for scope events";
      }
    }
    for (const key of ["occurredAt", "receivedAt", "emittedAt", "journaledAt"]) {
      const value = retained[key];
      if (value === undefined) continue;
      if (typeof value !== "string" || !isIsoDateTimeString(value)) {
        return `retained.${key} must be an ISO date-time string`;
      }
    }
  }

  if (artifactType === "workflow-run") {
    if (typeof retained.workflow !== "string" || retained.workflow.trim().length === 0) {
      return "retained.workflow must be a non-empty string";
    }
    if (typeof retained.status !== "string" || !WORKFLOW_RUN_STATUSES.has(retained.status)) {
      return `retained.status ${String(retained.status)} is not a workflow run status`;
    }
    if (typeof retained.startedAt !== "string" || !isIsoDateTimeString(retained.startedAt)) {
      return "retained.startedAt must be an ISO date-time string";
    }
    if (retained.completedAt !== undefined) {
      const completedAt = retained.completedAt;
      if (typeof completedAt !== "string" || !isIsoDateTimeString(completedAt)) {
        return "retained.completedAt must be an ISO date-time string";
      }
    }
  }

  return null;
}

function provenanceError(
  provenance: EvidenceProvenance | undefined,
  retained: EvidenceJsonObject | undefined,
  referenceId: string,
  expected: EvidencePrunedReferenceExpectation,
): string | null {
  if (provenance === undefined) return "provenance must be an object";
  const shapeError = hasObjectShape(provenance, "provenance");
  if (shapeError) return shapeError;
  if (!Array.isArray(provenance?.sourceEventIds)) {
    return "provenance.sourceEventIds must be an array";
  }
  for (const sourceEventId of provenance.sourceEventIds) {
    if (typeof sourceEventId !== "string" || sourceEventId.trim().length === 0) {
      return "provenance.sourceEventIds must contain only non-empty strings";
    }
  }
  if (!Array.isArray(provenance.transformedFrom)) {
    return "provenance.transformedFrom must be an array";
  }
  for (const reference of provenance.transformedFrom) {
    if (
      typeof reference !== "object" ||
      reference === null ||
      !EVIDENCE_ARTIFACT_TYPES.has(reference.artifactType) ||
      typeof reference.id !== "string" ||
      reference.id.trim().length === 0
    ) {
      return "provenance.transformedFrom must contain artifact references";
    }
  }

  const transformedEventIds = provenance.transformedFrom
    .filter((entry) => entry.artifactType === "event-envelope")
    .map((entry) => entry.id);
  if (!sameStringArray(provenance.sourceEventIds, transformedEventIds)) {
    return "provenance.sourceEventIds must match event-envelope transformedFrom ids";
  }

  if (expected.artifactType === "workflow-run") {
    if (provenance.runId !== referenceId) {
      return `provenance.runId ${String(provenance.runId)} does not match reference id ${referenceId}`;
    }
    if (provenance.workflowName !== retained?.workflow) {
      return `provenance.workflowName ${String(provenance.workflowName)} does not match retained.workflow ${String(retained?.workflow)}`;
    }
  }

  const expectedProvenance = expected.provenance;
  if (expectedProvenance?.workflowName !== undefined) {
    if (provenance.workflowName !== expectedProvenance.workflowName) {
      return `provenance.workflowName ${String(provenance.workflowName)} does not match expected ${expectedProvenance.workflowName}`;
    }
  }
  if (expectedProvenance?.runId !== undefined) {
    if (provenance.runId !== expectedProvenance.runId) {
      return `provenance.runId ${String(provenance.runId)} does not match expected ${expectedProvenance.runId}`;
    }
  }
  if (expectedProvenance?.sourceEventIds !== undefined) {
    if (!sameStringArray(provenance.sourceEventIds, expectedProvenance.sourceEventIds)) {
      return "provenance.sourceEventIds do not match expected sourceEventIds";
    }
  }
  if (expectedProvenance?.transformedFrom !== undefined) {
    if (!sameArtifactReferences(provenance.transformedFrom, expectedProvenance.transformedFrom)) {
      return "provenance.transformedFrom does not match expected transformedFrom";
    }
  }

  return null;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function sameArtifactReferences(
  left: readonly EvidenceArtifactReference[],
  right: readonly EvidenceArtifactReference[],
): boolean {
  return left.length === right.length &&
    left.every((entry, index) => {
      const other = right[index];
      return other?.artifactType === entry.artifactType && other.id === entry.id;
    });
}

export function validateEvidencePrunedReference(
  reference: Partial<EvidencePrunedReference>,
  expected: EvidencePrunedReferenceExpectation,
): EvidencePrunedReferenceValidation {
  const idResult = requiredString(reference.id, "id");
  if (!idResult.ok) return { ok: false, reason: idResult.reason };
  const referenceId = idResult.value;
  if (expected.id !== undefined && referenceId !== expected.id) {
    return {
      ok: false,
      reason: `id ${referenceId} does not match expected ${expected.id}`,
    };
  }
  if (reference.artifactType !== expected.artifactType) {
    return {
      ok: false,
      reason:
        `artifactType ${String(reference.artifactType)} does not match expected ${expected.artifactType}`,
    };
  }
  const prunedAtError = dateTimeError(reference.prunedAt, "prunedAt");
  if (prunedAtError) return { ok: false, reason: prunedAtError };
  if (reference.payloadExpired !== true) {
    return { ok: false, reason: "payloadExpired must be true" };
  }
  const retainedError = retainedMetadataError(reference.retained, referenceId, expected);
  if (retainedError) return { ok: false, reason: retainedError };
  const provenanceValidationError = provenanceError(
    reference.provenance,
    reference.retained,
    referenceId,
    expected,
  );
  if (provenanceValidationError) return { ok: false, reason: provenanceValidationError };
  return { ok: true, reference: reference as EvidencePrunedReference };
}
