import { existsSync, readFileSync } from "node:fs";
import { writeJsonFileAtomic } from "#core/util/json-file.js";
import {
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "#modules/autonomy/review-scrutiny-types.js";
import {
  AUTONOMY_CHANGE_CLASSES,
  AUTONOMY_CHANGE_DECISION_ARTIFACT_TYPE,
  AUTONOMY_CHANGE_DECISION_SCHEMA_VERSION,
  AUTONOMY_DECISIONS,
  AUTONOMY_METRIC_DIRECTIONS,
  AUTONOMY_ROLLOUT_MODES,
  type AutonomyChangeDecisionArtifact,
  type AutonomyChangeDecisionReadResult,
  type AutonomyDecisionMetric,
} from "./autonomy-change-decision-types.js";

function fail(field: string, message: string): never {
  throw new Error(`${field}: ${message}`);
}

function stringField(object: JsonObject, field: string): string {
  const raw = object[field];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    fail(field, "must be a non-empty string");
  }
  return raw.trim();
}

function booleanField(object: JsonObject, field: string): boolean {
  const raw = object[field];
  if (typeof raw !== "boolean") fail(field, "must be a boolean");
  return raw;
}

function stringArrayField(
  object: JsonObject,
  field: string,
  options: { nonEmpty: boolean },
): string[] {
  const raw = object[field];
  if (!Array.isArray(raw)) fail(field, "must be an array of strings");
  const values: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      fail(field, "must contain only non-empty strings");
    }
    values.push(entry.trim());
  }
  if (options.nonEmpty && values.length === 0) {
    fail(field, "must contain at least one entry");
  }
  return values;
}

function objectArrayField(object: JsonObject, field: string): JsonObject[] {
  const raw = object[field];
  if (!Array.isArray(raw)) fail(field, "must be an array of objects");
  const values: JsonObject[] = [];
  for (const entry of raw) {
    if (!isJsonObject(entry)) fail(field, "must contain only objects");
    values.push(entry);
  }
  if (values.length === 0) fail(field, "must contain at least one entry");
  return values;
}

function enumField<T extends string>(
  object: JsonObject,
  field: string,
  allowed: readonly T[],
): T {
  const value = stringField(object, field);
  if (!allowed.includes(value as T)) {
    fail(field, `must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function enumArrayField<T extends string>(
  object: JsonObject,
  field: string,
  allowed: readonly T[],
): T[] {
  const values = stringArrayField(object, field, { nonEmpty: true });
  for (const value of values) {
    if (!allowed.includes(value as T)) {
      fail(field, `contains unsupported value "${value}"`);
    }
  }
  return values as T[];
}

function metricsField(object: JsonObject): AutonomyDecisionMetric[] {
  return objectArrayField(object, "metricsCompared").map((metric) => ({
    name: stringField(metric, "name"),
    baseline: stringField(metric, "baseline"),
    candidate: stringField(metric, "candidate"),
    unit: stringField(metric, "unit"),
    direction: enumField(metric, "direction", AUTONOMY_METRIC_DIRECTIONS),
    qualitySignal: booleanField(metric, "qualitySignal"),
  }));
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

export function parseAutonomyChangeDecisionArtifact(
  value: JsonValue,
): AutonomyChangeDecisionArtifact {
  if (!isJsonObject(value)) {
    throw new Error("autonomy-change-decision artifact must be a JSON object");
  }
  const schemaVersion = value.schemaVersion;
  if (schemaVersion !== AUTONOMY_CHANGE_DECISION_SCHEMA_VERSION) {
    fail("schemaVersion", `must be ${AUTONOMY_CHANGE_DECISION_SCHEMA_VERSION}`);
  }
  const artifactType = stringField(value, "artifactType");
  if (artifactType !== AUTONOMY_CHANGE_DECISION_ARTIFACT_TYPE) {
    fail("artifactType", `must be ${AUTONOMY_CHANGE_DECISION_ARTIFACT_TYPE}`);
  }
  const createdAt = stringField(value, "createdAt");
  if (!validTimestamp(createdAt)) {
    fail("createdAt", "must be an ISO timestamp");
  }
  return {
    schemaVersion: AUTONOMY_CHANGE_DECISION_SCHEMA_VERSION,
    artifactType: AUTONOMY_CHANGE_DECISION_ARTIFACT_TYPE,
    runId: stringField(value, "runId"),
    createdAt,
    taskIds: stringArrayField(value, "taskIds", { nonEmpty: true }),
    affectedSurfaces: stringArrayField(value, "affectedSurfaces", {
      nonEmpty: true,
    }),
    changeClasses: enumArrayField(
      value,
      "changeClasses",
      AUTONOMY_CHANGE_CLASSES,
    ),
    hypothesis: stringField(value, "hypothesis"),
    sourceRefs: stringArrayField(value, "sourceRefs", { nonEmpty: true }),
    baselineRefs: stringArrayField(value, "baselineRefs", { nonEmpty: true }),
    candidateRefs: stringArrayField(value, "candidateRefs", { nonEmpty: true }),
    metricsCompared: metricsField(value),
    rolloutMode: enumField(value, "rolloutMode", AUTONOMY_ROLLOUT_MODES),
    decision: enumField(value, "decision", AUTONOMY_DECISIONS),
    rationale: stringField(value, "rationale"),
    ownerSafetyExceptions: stringArrayField(value, "ownerSafetyExceptions", {
      nonEmpty: false,
    }),
    followUpTaskIds: stringArrayField(value, "followUpTaskIds", {
      nonEmpty: false,
    }),
  };
}

export function readAutonomyChangeDecisionArtifact(
  path: string,
): AutonomyChangeDecisionReadResult {
  if (!existsSync(path)) return { kind: "missing", path };
  let parsed: JsonValue;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8")) as JsonValue;
  } catch (error) {
    return {
      kind: "invalid",
      path,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  try {
    return {
      kind: "valid",
      path,
      artifact: parseAutonomyChangeDecisionArtifact(parsed),
    };
  } catch (error) {
    return {
      kind: "invalid",
      path,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function writeAutonomyChangeDecisionArtifact(
  path: string,
  artifact: AutonomyChangeDecisionArtifact,
): void {
  const normalized = parseAutonomyChangeDecisionArtifact(
    JSON.parse(JSON.stringify(artifact)) as JsonValue,
  );
  writeJsonFileAtomic(path, normalized);
}
