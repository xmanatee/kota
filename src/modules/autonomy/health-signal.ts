import { createHash } from "node:crypto";
import type { ModuleEventPayloadSchema } from "#core/events/module-event.js";
import { defineProjectScopedModuleEvent } from "#core/events/project-scope.js";

export const AUTONOMY_HEALTH_SEVERITIES = [
  "info",
  "warning",
  "error",
  "critical",
] as const;

export const AUTONOMY_HEALTH_ACTIONABILITIES = [
  "local-code",
  "owner-action",
  "external-service",
  "informational",
] as const;

export const AUTONOMY_HEALTH_EVIDENCE_KINDS = [
  "run",
  "event",
  "task",
  "dead-letter",
  "module-log",
  "git",
  "artifact",
] as const;

export type AutonomyHealthSeverity = (typeof AUTONOMY_HEALTH_SEVERITIES)[number];
export type AutonomyHealthActionability =
  (typeof AUTONOMY_HEALTH_ACTIONABILITIES)[number];
export type AutonomyHealthEvidenceKind =
  (typeof AUTONOMY_HEALTH_EVIDENCE_KINDS)[number];

export type AutonomyHealthSignalSource = {
  kind: string;
  id: string;
  module?: string;
  workflow?: string;
  stepId?: string;
};

export type AutonomyHealthEvidenceRef = {
  kind: AutonomyHealthEvidenceKind;
  ref: string;
  summary?: string;
};

export type AutonomyHealthSignalInput = {
  signalId?: string;
  source: AutonomyHealthSignalSource;
  severity: AutonomyHealthSeverity;
  labels: readonly string[];
  summary: string;
  evidenceRefs: readonly AutonomyHealthEvidenceRef[];
  actionability: AutonomyHealthActionability;
  dedupeKey: string;
  observationCount: number;
  createdAt: string;
};

export type AutonomyHealthSignal = {
  signalId: string;
  source: AutonomyHealthSignalSource;
  severity: AutonomyHealthSeverity;
  labels: string[];
  labelsKey: string;
  summary: string;
  evidenceRefs: AutonomyHealthEvidenceRef[];
  actionability: AutonomyHealthActionability;
  dedupeKey: string;
  observationCount: number;
  createdAt: string;
};

export type AutonomyHealthSignalPayload = AutonomyHealthSignal;

const LABEL_RE = /^[a-z0-9][a-z0-9._/-]*$/;
const DEDUPE_KEY_RE = /^[a-z0-9][a-z0-9:._/-]*$/;
const SOURCE_TOKEN_RE = /^[a-z0-9][a-z0-9:._/-]*$/i;

export type AutonomyHealthJsonPrimitive = string | number | boolean | null;
export type AutonomyHealthJsonObject = {
  [key: string]: AutonomyHealthJsonValue | undefined;
};
export type AutonomyHealthJsonValue =
  | AutonomyHealthJsonPrimitive
  | AutonomyHealthJsonObject
  | readonly AutonomyHealthJsonValue[];

export function isAutonomyHealthJsonObject(
  value: AutonomyHealthJsonValue | undefined,
): value is AutonomyHealthJsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertNonEmptyString(
  value: AutonomyHealthJsonValue | undefined,
  field: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function assertSeverity(
  value: AutonomyHealthJsonValue | undefined,
): AutonomyHealthSeverity {
  if (
    typeof value !== "string" ||
    !AUTONOMY_HEALTH_SEVERITIES.includes(value as AutonomyHealthSeverity)
  ) {
    throw new Error(
      `severity must be one of ${AUTONOMY_HEALTH_SEVERITIES.join(", ")}`,
    );
  }
  return value as AutonomyHealthSeverity;
}

function assertActionability(
  value: AutonomyHealthJsonValue | undefined,
): AutonomyHealthActionability {
  if (
    typeof value !== "string" ||
    !AUTONOMY_HEALTH_ACTIONABILITIES.includes(
      value as AutonomyHealthActionability,
    )
  ) {
    throw new Error(
      `actionability must be one of ${AUTONOMY_HEALTH_ACTIONABILITIES.join(", ")}`,
    );
  }
  return value as AutonomyHealthActionability;
}

function assertEvidenceKind(
  value: AutonomyHealthJsonValue | undefined,
): AutonomyHealthEvidenceKind {
  if (
    typeof value !== "string" ||
    !AUTONOMY_HEALTH_EVIDENCE_KINDS.includes(value as AutonomyHealthEvidenceKind)
  ) {
    throw new Error(
      `evidence ref kind must be one of ${AUTONOMY_HEALTH_EVIDENCE_KINDS.join(", ")}`,
    );
  }
  return value as AutonomyHealthEvidenceKind;
}

function normalizeSource(
  value: AutonomyHealthJsonValue | undefined,
): AutonomyHealthSignalSource {
  if (!isAutonomyHealthJsonObject(value)) throw new Error("source must be an object");
  const kind = assertNonEmptyString(value.kind, "source.kind");
  const id = assertNonEmptyString(value.id, "source.id");
  if (!SOURCE_TOKEN_RE.test(kind)) {
    throw new Error("source.kind must be a stable token");
  }
  if (!SOURCE_TOKEN_RE.test(id)) {
    throw new Error("source.id must be a stable token");
  }
  const optional = (field: "module" | "workflow" | "stepId") => {
    const raw = value[field];
    if (raw === undefined) return undefined;
    const normalized = assertNonEmptyString(raw, `source.${field}`);
    if (!SOURCE_TOKEN_RE.test(normalized)) {
      throw new Error(`source.${field} must be a stable token`);
    }
    return normalized;
  };
  const module = optional("module");
  const workflow = optional("workflow");
  const stepId = optional("stepId");
  return {
    kind,
    id,
    ...(module !== undefined ? { module } : {}),
    ...(workflow !== undefined ? { workflow } : {}),
    ...(stepId !== undefined ? { stepId } : {}),
  };
}

function normalizeLabels(value: AutonomyHealthJsonValue | undefined): string[] {
  if (!Array.isArray(value)) throw new Error("labels must be an array");
  const labels = value.map((entry, index) => {
    const label = assertNonEmptyString(entry, `labels[${index}]`).toLowerCase();
    if (!LABEL_RE.test(label)) {
      throw new Error(`labels[${index}] must be a stable label token`);
    }
    return label;
  });
  if (labels.length === 0) {
    throw new Error("labels must contain at least one label");
  }
  return [...new Set(labels)].sort((a, b) => a.localeCompare(b));
}

function normalizeEvidenceRefs(
  value: AutonomyHealthJsonValue | undefined,
): AutonomyHealthEvidenceRef[] {
  if (!Array.isArray(value)) throw new Error("evidenceRefs must be an array");
  if (value.length === 0) {
    throw new Error("health signal must carry at least one evidence ref");
  }
  return value.map((entry, index) => {
    if (!isAutonomyHealthJsonObject(entry)) {
      throw new Error(`evidenceRefs[${index}] must be an object`);
    }
    const kind = assertEvidenceKind(entry.kind);
    const ref = assertNonEmptyString(entry.ref, `evidenceRefs[${index}].ref`);
    const summary =
      entry.summary === undefined
        ? undefined
        : assertNonEmptyString(entry.summary, `evidenceRefs[${index}].summary`);
    return {
      kind,
      ref,
      ...(summary !== undefined ? { summary } : {}),
    };
  });
}

function assertIsoDate(
  value: AutonomyHealthJsonValue | undefined,
  field: string,
): string {
  const normalized = assertNonEmptyString(value, field);
  if (Number.isNaN(Date.parse(normalized))) {
    throw new Error(`${field} must be an ISO date-time string`);
  }
  return normalized;
}

function assertPositiveInteger(
  value: AutonomyHealthJsonValue | undefined,
  field: string,
): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
  return value;
}

function stableJson(value: AutonomyHealthJsonValue | undefined): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (isAutonomyHealthJsonObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: string, length = 16): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function normalizeWithoutSignalId(input: AutonomyHealthSignalInput): Omit<
  AutonomyHealthSignal,
  "signalId"
> {
  const source = normalizeSource(input.source as AutonomyHealthJsonObject);
  const severity = assertSeverity(input.severity);
  const labels = normalizeLabels(input.labels);
  const summary = assertNonEmptyString(input.summary, "summary");
  const evidenceRefs = normalizeEvidenceRefs(
    input.evidenceRefs as readonly AutonomyHealthJsonValue[],
  );
  const actionability = assertActionability(input.actionability);
  const dedupeKey = assertNonEmptyString(input.dedupeKey, "dedupeKey").toLowerCase();
  if (!DEDUPE_KEY_RE.test(dedupeKey)) {
    throw new Error("dedupeKey must be a stable lowercase token path");
  }
  const observationCount = assertPositiveInteger(
    input.observationCount,
    "observationCount",
  );
  const createdAt = assertIsoDate(input.createdAt, "createdAt");
  return {
    source,
    severity,
    labels,
    labelsKey: labels.join(","),
    summary,
    evidenceRefs,
    actionability,
    dedupeKey,
    observationCount,
    createdAt,
  };
}

export function stableHealthSignalId(input: AutonomyHealthSignalInput): string {
  const normalized = normalizeWithoutSignalId(input);
  return `health-${hash(stableJson(normalized as AutonomyHealthJsonObject))}`;
}

export function normalizeHealthSignal(
  input: AutonomyHealthSignalInput,
): AutonomyHealthSignal {
  const normalized = normalizeWithoutSignalId(input);
  const signalId =
    input.signalId === undefined
      ? stableHealthSignalId(input)
      : assertNonEmptyString(input.signalId, "signalId");
  if (!DEDUPE_KEY_RE.test(signalId)) {
    throw new Error("signalId must be a stable token");
  }
  return { signalId, ...normalized };
}

const healthSignalPayloadSchema: ModuleEventPayloadSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    signalId: { type: "string" },
    source: {
      type: "object",
      additionalProperties: true,
      properties: {
        kind: { type: "string" },
        id: { type: "string" },
        module: { type: "string", required: false },
        workflow: { type: "string", required: false },
        stepId: { type: "string", required: false },
      },
    },
    severity: {
      type: "string",
      enum: AUTONOMY_HEALTH_SEVERITIES,
      filterable: true,
    },
    labels: {
      type: "array",
      items: { type: "string" },
      filterable: true,
    },
    labelsKey: { type: "string", filterable: true },
    summary: { type: "string" },
    evidenceRefs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: AUTONOMY_HEALTH_EVIDENCE_KINDS },
          ref: { type: "string" },
          summary: { type: "string", required: false },
        },
      },
    },
    actionability: {
      type: "string",
      enum: AUTONOMY_HEALTH_ACTIONABILITIES,
      filterable: true,
    },
    dedupeKey: { type: "string", filterable: true },
    observationCount: { type: "number" },
    createdAt: { type: "string", format: "date-time" },
  },
};

export const autonomyHealthSignal =
  defineProjectScopedModuleEvent<AutonomyHealthSignalPayload>(
    "autonomy.health.signal",
    [
      "signalId",
      "source",
      "severity",
      "labels",
      "labelsKey",
      "summary",
      "evidenceRefs",
      "actionability",
      "dedupeKey",
      "observationCount",
      "createdAt",
    ],
    {
      payloadSchema: healthSignalPayloadSchema,
      filterablePaths: [
        "source.kind",
        "source.id",
        "severity",
        "labels",
        "labelsKey",
        "actionability",
        "dedupeKey",
      ],
      examples: [
        {
          name: "workflow runtime warning",
          payload: {
            scopeId: "example-scope",
            projectId: "example-scope",
            signalId: "health-example",
            source: { kind: "workflow", id: "builder" },
            severity: "warning",
            labels: ["runtime"],
            labelsKey: "runtime",
            summary: "Builder repeatedly hit the same local runtime issue.",
            evidenceRefs: [
              {
                kind: "run",
                ref: ".kota/runs/example/metadata.json",
                summary: "builder run example",
              },
            ],
            actionability: "local-code",
            dedupeKey: "workflow:builder:runtime-warning",
            observationCount: 1,
            createdAt: "2026-06-17T12:00:00.000Z",
          },
        },
      ],
    },
  );
