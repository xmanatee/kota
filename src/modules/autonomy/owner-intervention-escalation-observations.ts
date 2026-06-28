import type {
  OwnerInterventionPatternActionability,
  OwnerInterventionPatternDimension,
  OwnerInterventionPatternKind,
} from "./owner-intervention-escalation-types.js";
import type {
  OwnerInterventionRecord,
} from "./report/owner-intervention-types.js";

export type PatternObservation = {
  kind: OwnerInterventionPatternKind;
  actionability: OwnerInterventionPatternActionability;
  dimension: OwnerInterventionPatternDimension;
  record: OwnerInterventionRecord;
  codeActionableReason: string | null;
  ignoredReason: string | null;
};

function taskFamily(taskId: string): string {
  const generated = /^(task-repair-[a-z0-9-]+-pattern)-[a-f0-9]{8,16}$/i.exec(
    taskId,
  );
  return generated?.[1] ?? taskId;
}

function recordPatternDimensions(
  record: OwnerInterventionRecord,
): OwnerInterventionPatternDimension[] {
  const dimensions: OwnerInterventionPatternDimension[] = [];
  if (record.taskId) {
    const family = taskFamily(record.taskId);
    dimensions.push(
      family === record.taskId
        ? { kind: "task", value: record.taskId }
        : { kind: "task-family", value: family },
    );
  }
  if (record.workflowName) {
    dimensions.push({ kind: "workflow", value: record.workflowName });
  }
  dimensions.push({ kind: "source", value: record.source });
  return dimensions;
}

function hasLegacyOrUnknown(record: OwnerInterventionRecord): boolean {
  return (
    record.markers.includes("legacy-origin") ||
    record.markers.includes("legacy-answer-behavior") ||
    record.answerBehavior === "unknown"
  );
}

function unansweredPressure(record: OwnerInterventionRecord): boolean {
  return (
    record.markers.includes("stale-pending") ||
    record.markers.includes("resolved-by-timeout")
  );
}

function observationForRecord(
  record: OwnerInterventionRecord,
  dimension: OwnerInterventionPatternDimension,
): PatternObservation | null {
  if (hasLegacyOrUnknown(record)) {
    return {
      kind: unansweredPressure(record)
        ? "repeated-stale-or-expired"
        : "repeated-freeform-correction",
      actionability: "ignored",
      dimension,
      record,
      codeActionableReason: null,
      ignoredReason:
        "legacy/unknown owner-question records lack enough metadata for auto-escalation.",
    };
  }
  if (
    record.outcomeBucket === "provider-noise-dismissal" ||
    record.outcomeBucket === "setup-action"
  ) {
    return {
      kind: "repeated-freeform-correction",
      actionability: "ignored",
      dimension,
      record,
      codeActionableReason: null,
      ignoredReason:
        "owner answers classify as provider/setup-only pressure; keep this as report evidence.",
    };
  }
  if (record.outcomeBucket === "freeform-correction") {
    return {
      kind: "repeated-freeform-correction",
      actionability: "code-actionable",
      dimension,
      record,
      codeActionableReason:
        `repeated free-form owner corrections for ${dimension.kind} ${dimension.value}`,
      ignoredReason: null,
    };
  }
  if (unansweredPressure(record)) {
    if (record.answerBehavior === "record-only") {
      return {
        kind: "repeated-stale-or-expired",
        actionability: "ignored",
        dimension,
        record,
        codeActionableReason: null,
        ignoredReason:
          "record-only owner questions preserve operator follow-up evidence without blocking workflow progress.",
      };
    }
    return {
      kind: "repeated-stale-or-expired",
      actionability: "code-actionable",
      dimension,
      record,
      codeActionableReason:
        `repeated stale or expired owner questions for ${dimension.kind} ${dimension.value}`,
      ignoredReason: null,
    };
  }
  return null;
}

export function observationsForRecord(
  record: OwnerInterventionRecord,
): PatternObservation[] {
  return recordPatternDimensions(record)
    .map((dimension) => observationForRecord(record, dimension))
    .filter((observation): observation is PatternObservation => observation !== null);
}

export function observationKey(observation: PatternObservation): string {
  return [
    observation.kind,
    observation.actionability,
    observation.dimension.kind,
    observation.dimension.value,
    observation.ignoredReason ?? "",
  ].join("\0");
}
