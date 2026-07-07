import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import {
  isJsonObject,
  type JsonObject,
  type JsonValue,
  objectArray,
  stringArray,
  stringValue,
} from "#modules/autonomy/review-scrutiny-types.js";
import {
  SHADOW_SEMANTIC_REVIEW_ARTIFACT_TYPE,
  SHADOW_SEMANTIC_REVIEW_DIR,
  SHADOW_SEMANTIC_REVIEW_SCHEMA_VERSION,
  type ShadowSemanticReviewArtifact,
  type ShadowSemanticReviewDecision,
  type ShadowSemanticReviewFinding,
  type ShadowSemanticReviewFindingSeverity,
  type ShadowSemanticReviewMode,
  type ShadowSemanticReviewReport,
  type ShadowSemanticReviewReportRecord,
  type ShadowSemanticReviewStatus,
  type ShadowSemanticReviewTargetKind,
  type ShadowSemanticReviewUnsupportedArtifact,
} from "#modules/autonomy/shadow-semantic-review-types.js";

function stringEnum<T extends string>(
  value: JsonValue | undefined,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value === "string" && allowed.includes(value as T)) return value as T;
  throw new Error(`${field}: unsupported value ${String(value)}`);
}

function numberOrNull(value: JsonValue | undefined, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`${field}: expected number or null`);
}

function requiredString(obj: JsonObject, field: string, label = field): string {
  const value = stringValue(obj[field]);
  if (!value) throw new Error(`${label}: must be a non-empty string`);
  return value;
}

function parseFinding(value: JsonObject): ShadowSemanticReviewFinding {
  const falsePositive = value.falsePositive === true;
  const falsePositiveReason = stringValue(value.falsePositiveReason) ?? undefined;
  return {
    severity: stringEnum<ShadowSemanticReviewFindingSeverity>(
      value.severity,
      ["info", "warning", "critical"],
      "findings[].severity",
    ),
    summary: requiredString(value, "summary", "findings[].summary"),
    citedArtifacts: stringArray(value.citedArtifacts),
    falsePositive,
    ...(falsePositiveReason ? { falsePositiveReason } : {}),
  };
}

function parseTarget(value: JsonValue | undefined): ShadowSemanticReviewArtifact["target"] {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) throw new Error("target: expected object");
  return {
    id: requiredString(value, "id", "target.id"),
    summary: requiredString(value, "summary", "target.summary"),
    artifactPaths: stringArray(value.artifactPaths),
  };
}

export function parseShadowSemanticReviewArtifact(
  value: JsonValue,
): ShadowSemanticReviewArtifact {
  if (!isJsonObject(value)) {
    throw new Error("shadow semantic review artifact must be a JSON object");
  }
  if (value.schemaVersion !== SHADOW_SEMANTIC_REVIEW_SCHEMA_VERSION) {
    throw new Error(`schemaVersion: must be ${SHADOW_SEMANTIC_REVIEW_SCHEMA_VERSION}`);
  }
  if (value.artifactType !== SHADOW_SEMANTIC_REVIEW_ARTIFACT_TYPE) {
    throw new Error(`artifactType: must be ${SHADOW_SEMANTIC_REVIEW_ARTIFACT_TYPE}`);
  }
  return {
    schemaVersion: SHADOW_SEMANTIC_REVIEW_SCHEMA_VERSION,
    artifactType: SHADOW_SEMANTIC_REVIEW_ARTIFACT_TYPE,
    runId: requiredString(value, "runId"),
    workflow: requiredString(value, "workflow"),
    generatedAt: requiredString(value, "generatedAt"),
    declarationId: requiredString(value, "declarationId"),
    reviewerProfileId: requiredString(value, "reviewerProfileId"),
    reviewerPromptHash: requiredString(value, "reviewerPromptHash"),
    mode: stringEnum<ShadowSemanticReviewMode>(
      value.mode,
      ["shadow", "advisory", "blocking"],
      "mode",
    ),
    targetKind: stringEnum<ShadowSemanticReviewTargetKind>(
      value.targetKind,
      ["task-queue", "source-decision", "security", "pr-support"],
      "targetKind",
    ),
    promotionCandidateRef: requiredString(value, "promotionCandidateRef"),
    ...(stringValue(value.blockingDecisionArtifact)
      ? { blockingDecisionArtifact: stringValue(value.blockingDecisionArtifact)! }
      : {}),
    status: stringEnum<ShadowSemanticReviewStatus>(
      value.status,
      ["reviewed", "skipped", "malformed", "error"],
      "status",
    ),
    decision: stringEnum<ShadowSemanticReviewDecision>(
      value.decision,
      ["pass", "warn", "fail", "skip", "error"],
      "decision",
    ),
    target: parseTarget(value.target),
    summary: requiredString(value, "summary"),
    citedArtifacts: stringArray(value.citedArtifacts),
    findings: objectArray(value.findings).map(parseFinding),
    ...(stringValue(value.skippedReason)
      ? { skippedReason: stringValue(value.skippedReason)! }
      : {}),
    ...(stringValue(value.error) ? { error: stringValue(value.error)! } : {}),
    costUsd: numberOrNull(value.costUsd, "costUsd"),
    durationMs: numberOrNull(value.durationMs, "durationMs"),
  };
}

function readArtifact(path: string): { ok: true; artifact: ShadowSemanticReviewArtifact } | { ok: false; reason: string } {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as JsonValue;
    return { ok: true, artifact: parseShadowSemanticReviewArtifact(parsed) };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function countCatches(artifact: ShadowSemanticReviewArtifact): number {
  return artifact.findings.filter((finding) =>
    finding.severity === "warning" || finding.severity === "critical"
  ).length;
}

function countFalsePositives(artifact: ShadowSemanticReviewArtifact): number {
  return artifact.findings.filter((finding) => finding.falsePositive).length;
}

function toRecord(
  artifact: ShadowSemanticReviewArtifact,
  artifactRef: string,
): ShadowSemanticReviewReportRecord {
  return {
    runId: artifact.runId,
    workflow: artifact.workflow,
    generatedAt: artifact.generatedAt,
    artifact: artifactRef,
    declarationId: artifact.declarationId,
    reviewerProfileId: artifact.reviewerProfileId,
    mode: artifact.mode,
    targetKind: artifact.targetKind,
    status: artifact.status,
    decision: artifact.decision,
    catchCount: countCatches(artifact),
    falsePositiveCount: countFalsePositives(artifact),
    ...(artifact.skippedReason ? { skippedReason: artifact.skippedReason } : {}),
    costUsd: artifact.costUsd,
    durationMs: artifact.durationMs,
    promotionCandidateRef: artifact.promotionCandidateRef,
  };
}

function summarize(
  records: ShadowSemanticReviewReportRecord[],
  unsupported: ShadowSemanticReviewUnsupportedArtifact[],
): ShadowSemanticReviewReport {
  const totalCostUsd = records.reduce((sum, record) => sum + (record.costUsd ?? 0), 0);
  const durations = records
    .map((record) => record.durationMs)
    .filter((value): value is number => value !== null);
  const byWorkflow = new Map<string, ShadowSemanticReviewReport["byWorkflow"][number]>();
  for (const record of records) {
    const row = byWorkflow.get(record.workflow) ?? {
      workflow: record.workflow,
      artifacts: 0,
      catches: 0,
      falsePositiveAnnotations: 0,
      skippedTargetResolution: 0,
      malformedArtifacts: 0,
      totalCostUsd: 0,
    };
    row.artifacts += 1;
    row.catches += record.catchCount;
    row.falsePositiveAnnotations += record.falsePositiveCount;
    if (record.status === "skipped") row.skippedTargetResolution += 1;
    if (record.status === "malformed") row.malformedArtifacts += 1;
    row.totalCostUsd += record.costUsd ?? 0;
    byWorkflow.set(record.workflow, row);
  }
  for (const item of unsupported) {
    const row = byWorkflow.get(item.workflow) ?? {
      workflow: item.workflow,
      artifacts: 0,
      catches: 0,
      falsePositiveAnnotations: 0,
      skippedTargetResolution: 0,
      malformedArtifacts: 0,
      totalCostUsd: 0,
    };
    row.artifacts += 1;
    row.malformedArtifacts += 1;
    byWorkflow.set(item.workflow, row);
  }
  return {
    totalArtifacts: records.length + unsupported.length,
    reviewed: records.filter((record) => record.status === "reviewed").length,
    catches: records.reduce((sum, record) => sum + record.catchCount, 0),
    falsePositiveAnnotations: records.reduce(
      (sum, record) => sum + record.falsePositiveCount,
      0,
    ),
    skippedTargetResolution: records.filter((record) => record.status === "skipped").length,
    malformedArtifacts:
      records.filter((record) => record.status === "malformed").length +
      unsupported.length,
    errorArtifacts: records.filter((record) => record.status === "error").length,
    totalCostUsd,
    averageDurationMs:
      durations.length > 0
        ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
        : null,
    byWorkflow: [...byWorkflow.values()].sort((a, b) =>
      a.workflow.localeCompare(b.workflow)
    ),
    records: [...records].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)),
    unsupported,
  };
}

export function buildShadowSemanticReviewReport(args: {
  runs: readonly WorkflowRunMetadata[];
  runsDir: string;
}): ShadowSemanticReviewReport {
  const records: ShadowSemanticReviewReportRecord[] = [];
  const unsupported: ShadowSemanticReviewUnsupportedArtifact[] = [];
  for (const run of args.runs) {
    const dir = join(args.runsDir, run.id, SHADOW_SEMANTIC_REVIEW_DIR);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((entry) => entry.endsWith(".json")).sort()) {
      const ref = join(".kota", "runs", run.id, SHADOW_SEMANTIC_REVIEW_DIR, file);
      const read = readArtifact(join(dir, file));
      if (read.ok) records.push(toRecord(read.artifact, ref));
      else unsupported.push({ runId: run.id, workflow: run.workflow, artifact: ref, reason: read.reason });
    }
  }
  return summarize(records, unsupported);
}
