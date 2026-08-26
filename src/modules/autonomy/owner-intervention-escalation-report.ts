import {
  DEFAULT_OWNER_INTERVENTION_REPORT_LIMIT,
  type OwnerInterventionEscalationReport,
  type OwnerInterventionPattern,
  type OwnerInterventionPatternSummary,
} from "./owner-intervention-escalation-types.js";

function summarizePattern(
  pattern: OwnerInterventionPattern,
  reason: string,
): OwnerInterventionPatternSummary {
  return {
    kind: pattern.kind,
    dimension: pattern.dimension,
    questionCount: pattern.questionCount,
    distinctRunCount: pattern.distinctRunCount,
    outcomeBuckets: pattern.outcomeBuckets,
    patternFingerprint: pattern.fingerprint,
    reason,
    questionIds: pattern.questionIds,
    runIds: pattern.runIds,
  };
}

export function buildOwnerInterventionEscalationReport(args: {
  patterns: readonly OwnerInterventionPattern[];
  ignoredPatterns: readonly OwnerInterventionPattern[];
  belowThresholdPatterns: readonly OwnerInterventionPattern[];
  limit?: number;
}): OwnerInterventionEscalationReport {
  const limit = args.limit ?? DEFAULT_OWNER_INTERVENTION_REPORT_LIMIT;
  return {
    activePatterns: args.patterns
      .map((pattern) =>
        summarizePattern(
          pattern,
          pattern.codeActionableReason ?? pattern.kind,
        )
      )
      .slice(0, limit),
    ignoredPatterns: args.ignoredPatterns
      .map((pattern) =>
        summarizePattern(
          pattern,
          pattern.ignoredReason ?? "ignored owner-intervention pattern",
        )
      )
      .slice(0, limit),
    belowThresholdPatterns: args.belowThresholdPatterns
      .map((pattern) =>
        summarizePattern(
          pattern,
          pattern.belowThresholdReason ?? pattern.kind,
        )
      )
      .slice(0, limit),
  };
}
