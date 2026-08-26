import type { WorkflowBatchFlushPayload } from "#core/workflow/trigger-types.js";
import {
  type AutonomyHealthActionability,
  type AutonomyHealthEvidenceRef,
  type AutonomyHealthJsonObject,
  type AutonomyHealthJsonValue,
  type AutonomyHealthSeverity,
  type AutonomyHealthSignal,
  type AutonomyHealthSignalInput,
  autonomyHealthSignal,
  isAutonomyHealthJsonObject,
  normalizeHealthSignal,
} from "#modules/autonomy/health-signal.js";
import { autonomyHealthEvidenceFingerprint } from "./health-review-evidence-fingerprint.js";
import type {
  AutonomyHealthReview,
  AutonomyHealthReviewGroup,
} from "./health-review-types.js";

export {
  applyAutonomyHealthReviewActions,
  autonomyIssueObservationsFromReview,
  planAutonomyHealthReviewActions,
} from "./health-review-actions.js";
export {
  AUTONOMY_HEALTH_REVIEW_ARTIFACT,
  buildAutonomyHealthAttentionDigest,
  projectAutonomyHealthReviewArtifactForPersistence,
  projectAutonomyHealthReviewForArtifact,
  writeAutonomyHealthReviewArtifact,
} from "./health-review-artifact.js";
export type {
  AutonomyHealthAppliedAction,
  AutonomyHealthReview,
  AutonomyHealthReviewActionResult,
  AutonomyHealthReviewArtifact,
  AutonomyHealthReviewGroup,
} from "./health-review-types.js";

type TriggerPayload = WorkflowBatchFlushPayload | AutonomyHealthJsonObject;

const SEVERITY_RANK: Record<AutonomyHealthSeverity, number> = {
  info: 0,
  warning: 1,
  error: 2,
  critical: 3,
};

function isBatchPayload(payload: TriggerPayload): payload is WorkflowBatchFlushPayload {
  return (
    isAutonomyHealthJsonObject(payload as AutonomyHealthJsonValue) &&
    payload.sourceEventName === autonomyHealthSignal.name &&
    Array.isArray(payload.inputEvents)
  );
}

function signalFromJson(
  payload: AutonomyHealthJsonValue | undefined,
): AutonomyHealthSignal {
  if (!isAutonomyHealthJsonObject(payload)) {
    throw new Error("health signal payload must be an object");
  }
  return normalizeHealthSignal(payload as AutonomyHealthSignalInput);
}

function extractSignals(payload: TriggerPayload): AutonomyHealthSignal[] {
  if (isBatchPayload(payload)) {
    return payload.inputEvents.map((entry) =>
      signalFromJson(entry.payload as AutonomyHealthJsonObject)
    );
  }
  return [signalFromJson(payload)];
}

function countBy<T extends string>(
  values: readonly T[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function uniqueEvidenceRefs(
  refs: readonly AutonomyHealthEvidenceRef[],
): AutonomyHealthEvidenceRef[] {
  const byKey = new Map<string, AutonomyHealthEvidenceRef>();
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.ref}`;
    const existing = byKey.get(key);
    if (existing?.summary) continue;
    byKey.set(key, ref);
  }
  return [...byKey.values()].sort((a, b) =>
    `${a.kind}:${a.ref}`.localeCompare(`${b.kind}:${b.ref}`),
  );
}

function maxSeverity(values: readonly AutonomyHealthSeverity[]): AutonomyHealthSeverity {
  return values.reduce<AutonomyHealthSeverity>(
    (max, next) => (SEVERITY_RANK[next] > SEVERITY_RANK[max] ? next : max),
    "info",
  );
}

function primaryActionability(
  values: readonly AutonomyHealthActionability[],
): AutonomyHealthActionability {
  if (values.includes("local-code")) return "local-code";
  if (values.includes("owner-action")) return "owner-action";
  if (values.includes("external-service")) return "external-service";
  return "informational";
}

function groupSignals(
  signals: readonly AutonomyHealthSignal[],
): AutonomyHealthReviewGroup[] {
  const byDedupe = new Map<string, AutonomyHealthSignal[]>();
  for (const signal of signals) {
    const list = byDedupe.get(signal.dedupeKey) ?? [];
    list.push(signal);
    byDedupe.set(signal.dedupeKey, list);
  }

  return [...byDedupe.entries()]
    .map(([dedupeKey, grouped]) => {
      const latestObservation = grouped.at(-1)!.observation;
      const current = grouped.filter(
        (signal) => signal.observation === latestObservation,
      );
      const labels = uniqueStrings(current.flatMap((signal) => signal.labels));
      const evidenceRefs = uniqueEvidenceRefs(
        current.flatMap((signal) => signal.evidenceRefs),
      );
      return {
        dedupeKey,
        observation: latestObservation,
        labels,
        labelsKey: labels.join(","),
        source: current[0]!.source,
        severity: maxSeverity(current.map((signal) => signal.severity)),
        actionability: primaryActionability(
          current.map((signal) => signal.actionability),
        ),
        signalCount: current.length,
        observationCount: current.reduce(
          (total, signal) => total + signal.observationCount,
          0,
        ),
        signalIds: uniqueStrings(current.map((signal) => signal.signalId)),
        summaries: uniqueStrings(current.map((signal) => signal.summary)),
        evidenceRefs,
        evidenceFingerprint: autonomyHealthEvidenceFingerprint(
          dedupeKey,
          evidenceRefs,
        ),
      } satisfies AutonomyHealthReviewGroup;
    })
    .sort((a, b) => {
      const severityDelta = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (severityDelta !== 0) return severityDelta;
      return a.dedupeKey.localeCompare(b.dedupeKey);
    });
}

export function buildAutonomyHealthReview(args: {
  triggerPayload: TriggerPayload;
  generatedAt: string;
}): AutonomyHealthReview {
  const signals = extractSignals(args.triggerPayload);
  const labels = signals.flatMap((signal) => signal.labels);
  const trigger = isBatchPayload(args.triggerPayload)
    ? {
        kind: "batch" as const,
        sourceEventName: args.triggerPayload.sourceEventName,
        count: args.triggerPayload.count,
        groupingKey: args.triggerPayload.groupingKey,
        reason: args.triggerPayload.reason,
        scopeId: args.triggerPayload.scopeId,
        projectId: args.triggerPayload.projectId,
      }
    : {
        kind: "signal" as const,
        sourceEventName: autonomyHealthSignal.name,
        count: 1,
        scopeId:
          typeof args.triggerPayload.scopeId === "string"
            ? args.triggerPayload.scopeId
            : undefined,
        projectId:
          typeof args.triggerPayload.projectId === "string"
            ? args.triggerPayload.projectId
            : undefined,
      };

  return {
    generatedAt: args.generatedAt,
    trigger,
    scope: {
      ...(trigger.scopeId !== undefined ? { scopeId: trigger.scopeId } : {}),
      ...(trigger.projectId !== undefined ? { projectId: trigger.projectId } : {}),
    },
    signals,
    groups: groupSignals(signals),
    counts: {
      bySeverity: countBy(signals.map((signal) => signal.severity)),
      byActionability: countBy(signals.map((signal) => signal.actionability)),
      byLabel: countBy(labels),
    },
  };
}

export function buildAutonomyHealthReviewFromSignals(args: {
  signals: readonly AutonomyHealthSignal[];
  generatedAt: string;
  sourceEventName: string;
  reason: string;
}): AutonomyHealthReview {
  const labels = args.signals.flatMap((signal) => signal.labels);
  return {
    generatedAt: args.generatedAt,
    trigger: {
      kind: "batch",
      sourceEventName: args.sourceEventName,
      count: args.signals.length,
      reason: args.reason,
    },
    scope: {},
    signals: [...args.signals],
    groups: groupSignals(args.signals),
    counts: {
      bySeverity: countBy(args.signals.map((signal) => signal.severity)),
      byActionability: countBy(args.signals.map((signal) => signal.actionability)),
      byLabel: countBy(labels),
    },
  };
}
