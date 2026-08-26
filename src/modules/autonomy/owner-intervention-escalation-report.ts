import { proposeOwnerInterventionEscalation } from "./owner-intervention-escalation-tasks.js";
import {
  DEFAULT_OWNER_INTERVENTION_REPORT_LIMIT,
  type OwnerInterventionEscalationReport,
  type OwnerInterventionPattern,
  type OwnerInterventionPatternSummary,
} from "./owner-intervention-escalation-types.js";

function summarizePattern(
  pattern: OwnerInterventionPattern,
  action: OwnerInterventionPatternSummary["action"],
  reason: string,
): OwnerInterventionPatternSummary {
  return {
    kind: pattern.kind,
    dimension: pattern.dimension,
    questionCount: pattern.questionCount,
    distinctRunCount: pattern.distinctRunCount,
    outcomeBuckets: pattern.outcomeBuckets,
    repairTaskId: pattern.taskId,
    patternFingerprint: pattern.fingerprint,
    action,
    reason,
    questionIds: pattern.questionIds,
    runIds: pattern.runIds,
  };
}

export function buildOwnerInterventionEscalationReport(args: {
  workspaceRoot: string;
  patterns: readonly OwnerInterventionPattern[];
  ignoredPatterns: readonly OwnerInterventionPattern[];
  belowThresholdPatterns: readonly OwnerInterventionPattern[];
  limit?: number;
}): OwnerInterventionEscalationReport {
  const limit = args.limit ?? DEFAULT_OWNER_INTERVENTION_REPORT_LIMIT;
  return {
    activePatterns: args.patterns
      .map((pattern) => {
        const proposal = proposeOwnerInterventionEscalation(args.workspaceRoot, pattern);
        const reason = "reason" in proposal ? proposal.reason : pattern.codeActionableReason ?? pattern.kind;
        return summarizePattern(pattern, proposal.action, reason);
      })
      .slice(0, limit),
    ignoredPatterns: args.ignoredPatterns
      .map((pattern) =>
        summarizePattern(
          pattern,
          "ignored",
          pattern.ignoredReason ?? "ignored owner-intervention pattern",
        )
      )
      .slice(0, limit),
    belowThresholdPatterns: args.belowThresholdPatterns
      .map((pattern) =>
        summarizePattern(
          pattern,
          "below-threshold",
          pattern.belowThresholdReason ?? pattern.kind,
        )
      )
      .slice(0, limit),
  };
}
