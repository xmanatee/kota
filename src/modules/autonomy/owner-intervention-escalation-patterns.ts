import { createHash } from "node:crypto";
import type { PatternObservation } from "./owner-intervention-escalation-observations.js";
import {
  OWNER_INTERVENTION_TASK_ID_PREFIX,
  type OwnerInterventionEscalationConfig,
  type OwnerInterventionEvidenceRef,
  type OwnerInterventionPattern,
} from "./owner-intervention-escalation-types.js";
import type {
  OwnerInterventionRecord,
} from "./report/owner-intervention-types.js";

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function shortHash(value: string): string {
  return stableHash(value).slice(0, 12);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function uniqueSortedLiterals<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function evidenceRef(
  record: OwnerInterventionRecord,
): OwnerInterventionEvidenceRef {
  return {
    questionId: record.questionId,
    status: record.status,
    outcomeBucket: record.outcomeBucket,
    createdAt: record.createdAt,
    resolvedAt: record.resolvedAt,
    source: record.source,
    workflowName: record.workflowName,
    runId: record.runId,
    taskId: record.taskId,
    refs: record.refs,
    markers: record.markers,
  };
}

function belowThresholdReason(
  pattern: Pick<
    OwnerInterventionPattern,
    "questionCount" | "distinctRunCount" | "runIds"
  >,
  minQuestions: number,
  minDistinctRuns: number,
): string | null {
  const reasons: string[] = [];
  if (pattern.questionCount < minQuestions) {
    reasons.push(`${pattern.questionCount}/${minQuestions} questions`);
  }
  if (pattern.runIds.length > 0 && pattern.distinctRunCount < minDistinctRuns) {
    reasons.push(`${pattern.distinctRunCount}/${minDistinctRuns} distinct runs`);
  }
  return reasons.length > 0 ? `below threshold: ${reasons.join(", ")}` : null;
}

export function buildPattern(
  observations: PatternObservation[],
  config: Required<OwnerInterventionEscalationConfig>,
): OwnerInterventionPattern {
  const first = observations[0]!;
  const chronological = [...observations].sort(
    (a, b) =>
      Date.parse(a.record.createdAt) - Date.parse(b.record.createdAt) ||
      a.record.questionId.localeCompare(b.record.questionId),
  );
  const records = chronological.map((item) => item.record);
  const questionIds = uniqueSorted(records.map((record) => record.questionId));
  const runIds = uniqueSorted(
    records.map((record) => record.runId).filter((id): id is string => id !== null),
  );
  const taskIds = uniqueSorted(
    records.map((record) => record.taskId).filter((id): id is string => id !== null),
  );
  const sources = uniqueSorted(records.map((record) => record.source));
  const workflowNames = uniqueSorted(
    records
      .map((record) => record.workflowName)
      .filter((name): name is string => name !== null),
  );
  const outcomeBuckets = uniqueSortedLiterals(
    records.map((record) => record.outcomeBucket),
  );
  const statuses = uniqueSortedLiterals(records.map((record) => record.status));
  const fingerprint = [
    "owner-intervention",
    first.kind,
    first.actionability,
    first.dimension.kind,
    shortHash(first.dimension.value),
  ].join(":");
  const evidenceFingerprint = stableHash(
    JSON.stringify({
      fingerprint,
      questionIds,
      runIds,
      taskIds,
      outcomeBuckets,
      statuses,
      markers: records.flatMap((record) => record.markers).sort(),
    }),
  );
  const base = {
    kind: first.kind,
    actionability: first.actionability,
    fingerprint,
    evidenceFingerprint,
    taskId: `${OWNER_INTERVENTION_TASK_ID_PREFIX}${shortHash(fingerprint)}`,
    dimension: first.dimension,
    questionCount: records.length,
    distinctRunCount: runIds.length,
    outcomeBuckets,
    statuses,
    workflowNames,
    sources,
    taskIds,
    runIds,
    questionIds,
    windowStart: records[0]?.createdAt ?? "",
    windowEnd:
      records[records.length - 1]?.resolvedAt ??
      records[records.length - 1]?.createdAt ??
      "",
    evidence: records.map(evidenceRef),
    codeActionableReason: first.codeActionableReason,
    ignoredReason: first.ignoredReason,
  };
  return {
    ...base,
    belowThresholdReason: belowThresholdReason(
      base,
      config.minQuestions,
      config.minDistinctRuns,
    ),
  };
}

export function comparePatterns(
  a: OwnerInterventionPattern,
  b: OwnerInterventionPattern,
): number {
  return (
    b.questionCount - a.questionCount ||
    b.distinctRunCount - a.distinctRunCount ||
    a.kind.localeCompare(b.kind) ||
    a.dimension.kind.localeCompare(b.dimension.kind) ||
    a.dimension.value.localeCompare(b.dimension.value)
  );
}

function dimensionSpecificity(
  dimension: OwnerInterventionPattern["dimension"],
): number {
  switch (dimension.kind) {
    case "task":
    case "task-family":
      return 3;
    case "workflow":
      return 2;
    case "source":
      return 1;
  }
}

function duplicateEvidenceKey(pattern: OwnerInterventionPattern): string {
  return [
    pattern.kind,
    pattern.actionability,
    pattern.ignoredReason ?? "",
    pattern.questionIds.join("\0"),
  ].join("\0\0");
}

function preferDuplicatePattern(
  current: OwnerInterventionPattern,
  candidate: OwnerInterventionPattern,
): OwnerInterventionPattern {
  const specificity =
    dimensionSpecificity(candidate.dimension) -
    dimensionSpecificity(current.dimension);
  if (specificity > 0) return candidate;
  if (specificity < 0) return current;
  return comparePatterns(candidate, current) < 0 ? candidate : current;
}

export function collapseDuplicateDimensionPatterns(
  patterns: OwnerInterventionPattern[],
): OwnerInterventionPattern[] {
  const preferred = new Map<string, OwnerInterventionPattern>();
  for (const pattern of patterns) {
    const key = duplicateEvidenceKey(pattern);
    const existing = preferred.get(key);
    preferred.set(
      key,
      existing === undefined ? pattern : preferDuplicatePattern(existing, pattern),
    );
  }
  return [...preferred.values()].sort(comparePatterns);
}
