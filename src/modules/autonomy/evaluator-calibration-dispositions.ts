import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readOptionalJsonFile } from "#core/util/json-file.js";
import {
  EVALUATOR_CALIBRATION_DISPOSITIONS_ARTIFACT,
  type EvaluatorCalibrationContradictionDisposition,
  type EvaluatorCalibrationDispositionRecord,
  type EvaluatorCalibrationDispositionsArtifact,
} from "./evaluator-calibration-types.js";

const REVISION_RE = /^[0-9a-f]{40}$/;
const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const TASK_ID_RE = /^task-[a-z0-9][a-z0-9-]*$/;

function fail(path: string, detail: string): never {
  throw new Error(`Invalid evaluator calibration dispositions in ${path}: ${detail}`);
}

function object(value: unknown, path: string, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(path, `${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(
  value: unknown,
  path: string,
  field: string,
  pattern?: RegExp,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(path, `${field} must be a non-empty string`);
  }
  const normalized = value.trim();
  if (pattern && !pattern.test(normalized)) {
    fail(path, `${field} has an invalid format`);
  }
  return normalized;
}

function isoDate(value: unknown, path: string, field: string): string {
  const normalized = string(value, path, field);
  if (Number.isNaN(Date.parse(normalized))) fail(path, `${field} must be an ISO date`);
  return normalized;
}

function decodeDisposition(
  value: unknown,
  path: string,
  field: string,
): EvaluatorCalibrationContradictionDisposition {
  const input = object(value, path, field);
  const kind = string(input.kind, path, `${field}.kind`);
  const rationale = string(input.rationale, path, `${field}.rationale`);
  const decidedAt = isoDate(input.decidedAt, path, `${field}.decidedAt`);
  if (kind === "reclassified") {
    if (input.verdict !== "pass_with_warnings" && input.verdict !== "fail") {
      fail(path, `${field}.verdict must be pass_with_warnings or fail`);
    }
    return { kind, verdict: input.verdict, rationale, decidedAt };
  }
  if (kind === "accepted-overlap") return { kind, rationale, decidedAt };
  if (kind === "corrective-task") {
    return {
      kind,
      taskId: string(input.taskId, path, `${field}.taskId`, TASK_ID_RE),
      rationale,
      decidedAt,
    };
  }
  return fail(path, `${field}.kind is unsupported`);
}

function decodeIdentity(
  value: unknown,
  path: string,
  field: string,
): { runId: string; sourceRevision: string } {
  const input = object(value, path, field);
  return {
    runId: string(input.runId, path, `${field}.runId`, RUN_ID_RE),
    sourceRevision: string(
      input.sourceRevision,
      path,
      `${field}.sourceRevision`,
      REVISION_RE,
    ),
  };
}

export function decodeEvaluatorCalibrationDispositionsArtifact(
  value: unknown,
  path = EVALUATOR_CALIBRATION_DISPOSITIONS_ARTIFACT,
): EvaluatorCalibrationDispositionsArtifact {
  const input = object(value, path, "artifact");
  if (input.schemaVersion !== 1) fail(path, "schemaVersion must equal 1");
  if (!Array.isArray(input.records)) fail(path, "records must be an array");
  if (!Array.isArray(input.unavailableSources)) {
    fail(path, "unavailableSources must be an array");
  }
  const records = input.records.map((value, index): EvaluatorCalibrationDispositionRecord => {
    const record = object(value, path, `records[${index}]`);
    return {
      base: decodeIdentity(record.base, path, `records[${index}].base`),
      later: decodeIdentity(record.later, path, `records[${index}].later`),
      disposition: decodeDisposition(
        record.disposition,
        path,
        `records[${index}].disposition`,
      ),
    };
  });
  const unavailableSources = input.unavailableSources.map((value, index) => {
    const record = object(value, path, `unavailableSources[${index}]`);
    if (
      typeof record.expectedContradictionCount !== "number" ||
      !Number.isInteger(record.expectedContradictionCount) ||
      record.expectedContradictionCount < 1
    ) {
      fail(
        path,
        `unavailableSources[${index}].expectedContradictionCount must be a positive integer`,
      );
    }
    return {
      sourceRef: string(record.sourceRef, path, `unavailableSources[${index}].sourceRef`),
      expectedContradictionCount: record.expectedContradictionCount,
      reason: string(record.reason, path, `unavailableSources[${index}].reason`),
      checkedAt: isoDate(record.checkedAt, path, `unavailableSources[${index}].checkedAt`),
    };
  });
  if (records.length === 0 && unavailableSources.length === 0) {
    fail(path, "must contain a disposition record or unavailable source");
  }
  return { schemaVersion: 1, records, unavailableSources };
}

function dispositionKey(record: {
  base: { runId: string; sourceRevision: string };
  later: { runId: string; sourceRevision: string };
}): string {
  return [
    record.base.runId,
    record.base.sourceRevision,
    record.later.runId,
    record.later.sourceRevision,
  ].join(":");
}

function dispositionArtifactPaths(runsDir: string, runId: string): string[] {
  return [
    join(runsDir, runId, EVALUATOR_CALIBRATION_DISPOSITIONS_ARTIFACT),
    join(runsDir, runId, "agent", EVALUATOR_CALIBRATION_DISPOSITIONS_ARTIFACT),
    join(runsDir, runId, "artifacts", EVALUATOR_CALIBRATION_DISPOSITIONS_ARTIFACT),
    join(
      runsDir,
      runId,
      "evidence",
      "artifacts",
      EVALUATOR_CALIBRATION_DISPOSITIONS_ARTIFACT,
    ),
  ];
}

export function loadEvaluatorCalibrationDispositions(
  runsDir: string,
): ReadonlyMap<string, EvaluatorCalibrationContradictionDisposition> {
  const dispositions = new Map<string, EvaluatorCalibrationContradictionDisposition>();
  if (!existsSync(runsDir)) return dispositions;
  for (const runId of readdirSync(runsDir).sort()) {
    for (const path of dispositionArtifactPaths(runsDir, runId)) {
      const raw = readOptionalJsonFile<unknown>(path);
      if (raw === null) continue;
      for (const record of decodeEvaluatorCalibrationDispositionsArtifact(raw, path).records) {
        const key = dispositionKey(record);
        const existing = dispositions.get(key);
        if (existing && JSON.stringify(existing) !== JSON.stringify(record.disposition)) {
          fail(path, `conflicting disposition for ${key}`);
        }
        dispositions.set(key, record.disposition);
      }
    }
  }
  return dispositions;
}

export function evaluatorCalibrationDispositionKey(record: {
  base: { runId: string; sourceRevision: string };
  later: { runId: string; sourceRevision: string };
}): string {
  return dispositionKey(record);
}
