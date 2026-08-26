import { proposeReviewScrutinyEscalation } from "./review-scrutiny-escalation-tasks.js";
import {
  DEFAULT_REVIEW_SCRUTINY_REPORT_LIMIT,
  type ReviewScrutinyEscalationConfig,
  type ReviewScrutinyEscalationDetection,
  type ReviewScrutinyEscalationReport,
  type ReviewScrutinyPatternCandidate,
  type ReviewScrutinyPatternSummary,
} from "./review-scrutiny-escalation-types.js";

function summarizePattern(
  pattern: ReviewScrutinyPatternCandidate,
  action: ReviewScrutinyPatternSummary["action"],
  reason: string,
): ReviewScrutinyPatternSummary {
  return {
    surface: pattern.surface,
    workflow: pattern.workflow,
    taskArea: pattern.taskArea,
    taskClass: pattern.taskClass,
    approvalLikeDecisions: pattern.approvalLikeDecisions,
    thinAcceptances: pattern.thinAcceptances,
    thinAcceptanceRatio: pattern.thinAcceptanceRatio,
    repairTaskId: pattern.taskId,
    patternFingerprint: pattern.fingerprint,
    action,
    reason,
    runIds: pattern.runIds,
  };
}

export function buildReviewScrutinyEscalationReport(args: {
  workspaceRoot: string;
  detection: ReviewScrutinyEscalationDetection;
  config?: ReviewScrutinyEscalationConfig;
  limit?: number;
}): ReviewScrutinyEscalationReport {
  const activePatterns: ReviewScrutinyPatternSummary[] = [];
  const cooldownPatterns: ReviewScrutinyPatternSummary[] = [];
  for (const pattern of args.detection.patterns) {
    const proposal = proposeReviewScrutinyEscalation(
      args.workspaceRoot,
      pattern,
      args.config,
    );
    const reason = "reason" in proposal ? proposal.reason : pattern.reason;
    const summary = summarizePattern(pattern, proposal.action, reason);
    if (proposal.action === "noop" && proposal.suppression === "cooldown") {
      cooldownPatterns.push(summary);
    } else {
      activePatterns.push(summary);
    }
  }
  const limit = args.limit ?? DEFAULT_REVIEW_SCRUTINY_REPORT_LIMIT;
  return {
    activePatterns: activePatterns.slice(0, limit),
    cooldownPatterns: cooldownPatterns.slice(0, limit),
    belowThresholdPatterns: args.detection.belowThreshold
      .map((pattern) =>
        summarizePattern(
          pattern,
          "below-threshold",
          pattern.belowThresholdReason ?? pattern.reason,
        )
      )
      .slice(0, limit),
  };
}
