export type EvidenceJsonPrimitive = string | number | boolean | null;
export type EvidenceJsonValue =
  | EvidenceJsonPrimitive
  | EvidenceJsonObject
  | EvidenceJsonValue[];
export type EvidenceJsonObject = { [key: string]: EvidenceJsonValue | undefined };

export type EvidenceArtifactType =
  | "event-envelope"
  | "workflow-run"
  | "workflow-step"
  | "dead-letter-item"
  | "owner-decision"
  | "approval"
  | "setup-status"
  | "simulation-report"
  | "trace-log"
  | "exported-report";

export type EvidenceDataClass =
  | "public-metadata"
  | "operational-metadata"
  | "audit-provenance"
  | "source-content"
  | "owner-input"
  | "configuration"
  | "provider-payload"
  | "tool-io"
  | "pii"
  | "secret"
  | "credential"
  | "private-reasoning";

export type EvidenceSensitivity =
  | "public"
  | "internal"
  | "sensitive"
  | "secret"
  | "private";

export type EvidenceProjectionTarget =
  | "internal-storage"
  | "agent-context"
  | "daemon-api"
  | "cli-client"
  | "web-client"
  | "exported-report"
  | "logs-traces";

export type EvidenceRetentionScope = "daemon" | "global" | "directory";

export type EvidenceLifecycleState =
  | "active"
  | "terminal"
  | "pending"
  | "resolved"
  | "open"
  | "closed"
  | "ephemeral";

export type EvidenceRetentionPeriod =
  | { kind: "retain" }
  | { kind: "expire-after-ms"; durationMs: number };

export type EvidenceRetentionRule = {
  scope: EvidenceRetentionScope;
  state: EvidenceLifecycleState;
  retention: EvidenceRetentionPeriod;
  expiredPayload: "exclude-from-query" | "metadata-reference" | "delete-payload";
};

export type EvidenceArtifactPolicy = {
  artifactType: EvidenceArtifactType;
  dataClasses: readonly EvidenceDataClass[];
  sensitivity: EvidenceSensitivity;
  appendOnly: boolean;
  retention: readonly EvidenceRetentionRule[];
};

export type EvidenceRedactionProfile = {
  target: EvidenceProjectionTarget;
  preserveMetadata: boolean;
  omitPrivateReasoning: boolean;
  omitToolIo: boolean;
  omitProviderPayloads: boolean;
  scrubSecretsAndPii: boolean;
};

export type EvidenceArtifactReference = {
  artifactType: EvidenceArtifactType;
  id: string;
};

export type EvidenceProvenance = {
  producerModule?: string;
  actionId?: string;
  toolName?: string;
  workflowName?: string;
  runId?: string;
  stepId?: string;
  agentId?: string;
  sessionId?: string;
  sourceEventIds: readonly string[];
  ownerDecisionId?: string;
  transformedFrom: readonly EvidenceArtifactReference[];
};

export type EvidencePrunedReference = {
  artifactType: EvidenceArtifactType;
  id: string;
  prunedAt: string;
  retained: EvidenceJsonObject;
  provenance: EvidenceProvenance;
  payloadExpired: true;
};

export type EvidencePolicyModel = {
  artifacts: readonly EvidenceArtifactPolicy[];
  projectionTargets: readonly EvidenceProjectionTarget[];
  redactionProfiles: readonly EvidenceRedactionProfile[];
  prunedReferenceBehavior: "retain-id-timestamps-status-and-provenance";
};

export type EvidenceRedactionReason =
  | "secret"
  | "pii"
  | "private-reasoning"
  | "provider-payload"
  | "tool-io";

export type EvidenceRedactionMarker = {
  redacted: true;
  reason: EvidenceRedactionReason;
  bytes?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const SETUP_PENDING_TTL_MS = 10 * 60 * 1000;
const ALL_RETENTION_SCOPES: readonly EvidenceRetentionScope[] = [
  "daemon",
  "global",
  "directory",
];
export const EVIDENCE_REDACTED = "[redacted]";

export const EVIDENCE_POLICY: EvidencePolicyModel = {
  artifacts: [
    artifactPolicy(
      "event-envelope",
      ["operational-metadata", "audit-provenance", "source-content"],
      "internal",
      true,
      retentionForEveryScope("active", { kind: "retain" }, "exclude-from-query"),
    ),
    artifactPolicy(
      "workflow-run",
      ["operational-metadata", "audit-provenance", "tool-io"],
      "internal",
      true,
      [
        ...retentionForEveryScope("active", { kind: "expire-after-ms", durationMs: 30 * DAY_MS }, "metadata-reference"),
        ...retentionForEveryScope("terminal", { kind: "expire-after-ms", durationMs: 7 * DAY_MS }, "metadata-reference"),
      ],
    ),
    artifactPolicy(
      "workflow-step",
      ["operational-metadata", "tool-io", "private-reasoning"],
      "sensitive",
      true,
      retentionForEveryScope("terminal", { kind: "expire-after-ms", durationMs: 7 * DAY_MS }, "metadata-reference"),
    ),
    artifactPolicy(
      "dead-letter-item",
      ["operational-metadata", "audit-provenance", "provider-payload"],
      "sensitive",
      true,
      [
        ...retentionForEveryScope("open", { kind: "expire-after-ms", durationMs: 30 * DAY_MS }, "metadata-reference"),
        ...retentionForEveryScope("closed", { kind: "expire-after-ms", durationMs: 14 * DAY_MS }, "metadata-reference"),
      ],
    ),
    artifactPolicy(
      "owner-decision",
      ["owner-input", "audit-provenance"],
      "sensitive",
      false,
      [
        ...retentionForEveryScope("pending", { kind: "retain" }, "metadata-reference"),
        ...retentionForEveryScope("resolved", { kind: "retain" }, "metadata-reference"),
      ],
    ),
    artifactPolicy(
      "approval",
      ["operational-metadata", "tool-io", "audit-provenance"],
      "sensitive",
      false,
      [
        ...retentionForEveryScope("pending", { kind: "expire-after-ms", durationMs: DAY_MS }, "metadata-reference"),
        ...retentionForEveryScope("resolved", { kind: "expire-after-ms", durationMs: 14 * DAY_MS }, "metadata-reference"),
      ],
    ),
    artifactPolicy(
      "setup-status",
      ["configuration", "credential", "operational-metadata"],
      "sensitive",
      false,
      [
        ...retentionForEveryScope("pending", { kind: "expire-after-ms", durationMs: SETUP_PENDING_TTL_MS }, "metadata-reference"),
        ...retentionForEveryScope("active", { kind: "retain" }, "metadata-reference"),
      ],
    ),
    artifactPolicy(
      "simulation-report",
      ["operational-metadata", "provider-payload"],
      "internal",
      true,
      retentionForEveryScope("terminal", { kind: "expire-after-ms", durationMs: 30 * DAY_MS }, "metadata-reference"),
    ),
    artifactPolicy(
      "trace-log",
      ["operational-metadata", "tool-io"],
      "sensitive",
      true,
      retentionForEveryScope("ephemeral", { kind: "expire-after-ms", durationMs: 14 * DAY_MS }, "delete-payload"),
    ),
    artifactPolicy(
      "exported-report",
      ["operational-metadata", "audit-provenance"],
      "internal",
      true,
      retentionForEveryScope("terminal", { kind: "expire-after-ms", durationMs: 30 * DAY_MS }, "metadata-reference"),
    ),
  ],
  projectionTargets: [
    "internal-storage",
    "agent-context",
    "daemon-api",
    "cli-client",
    "web-client",
    "exported-report",
    "logs-traces",
  ],
  redactionProfiles: [
    redactionProfile("internal-storage", true, true, true, true, true),
    redactionProfile("agent-context", true, true, true, true, true),
    redactionProfile("daemon-api", true, true, true, true, true),
    redactionProfile("cli-client", true, true, true, true, true),
    redactionProfile("web-client", true, true, true, true, true),
    redactionProfile("exported-report", true, true, true, true, true),
    redactionProfile("logs-traces", true, true, true, true, true),
  ],
  prunedReferenceBehavior: "retain-id-timestamps-status-and-provenance",
};

function artifactPolicy(
  artifactType: EvidenceArtifactType,
  dataClasses: readonly EvidenceDataClass[],
  sensitivity: EvidenceSensitivity,
  appendOnly: boolean,
  retentionRules: readonly EvidenceRetentionRule[],
): EvidenceArtifactPolicy {
  return { artifactType, dataClasses, sensitivity, appendOnly, retention: retentionRules };
}

function retention(
  scope: EvidenceRetentionScope,
  state: EvidenceLifecycleState,
  period: EvidenceRetentionPeriod,
  expiredPayload: EvidenceRetentionRule["expiredPayload"],
): EvidenceRetentionRule {
  return { scope, state, retention: period, expiredPayload };
}

function retentionForEveryScope(
  state: EvidenceLifecycleState,
  period: EvidenceRetentionPeriod,
  expiredPayload: EvidenceRetentionRule["expiredPayload"],
): EvidenceRetentionRule[] {
  return ALL_RETENTION_SCOPES.map((scope) => retention(scope, state, period, expiredPayload));
}

function redactionProfile(
  target: EvidenceProjectionTarget,
  preserveMetadata: boolean,
  omitPrivateReasoning: boolean,
  omitToolIo: boolean,
  omitProviderPayloads: boolean,
  scrubSecretsAndPii: boolean,
): EvidenceRedactionProfile {
  return {
    target,
    preserveMetadata,
    omitPrivateReasoning,
    omitToolIo,
    omitProviderPayloads,
    scrubSecretsAndPii,
  };
}
