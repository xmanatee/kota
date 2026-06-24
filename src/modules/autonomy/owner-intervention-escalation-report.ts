import { proposeOwnerInterventionEscalation } from "./owner-intervention-escalation-tasks.js";
import {
  DEFAULT_OWNER_INTERVENTION_REPORT_LIMIT,
  type OwnerInterventionAttentionEntry,
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
  projectDir: string;
  patterns: readonly OwnerInterventionPattern[];
  ignoredPatterns: readonly OwnerInterventionPattern[];
  belowThresholdPatterns: readonly OwnerInterventionPattern[];
  limit?: number;
}): OwnerInterventionEscalationReport {
  const limit = args.limit ?? DEFAULT_OWNER_INTERVENTION_REPORT_LIMIT;
  return {
    activePatterns: args.patterns
      .map((pattern) => {
        const proposal = proposeOwnerInterventionEscalation(args.projectDir, pattern);
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

export function buildOwnerInterventionAttentionDigest(
  entries: OwnerInterventionAttentionEntry[],
): { items: Array<{ label: string; detail: string }>; text: string } {
  const items = entries.map((entry) => ({
    label: "Owner intervention escalated",
    detail:
      `${entry.kind} ${entry.dimension.kind} ${entry.dimension.value}; ` +
      `task ${entry.taskId}; action ${entry.action}; questions ${entry.questionCount}; ` +
      `runs ${entry.runIds.join(", ") || "(none)"}`,
  }));
  const header = `Attention digest (${items.length} item${items.length === 1 ? "" : "s"}):`;
  return {
    items,
    text: [header, ...items.map((item) => `• *${item.label}*: ${item.detail}`)].join("\n"),
  };
}
