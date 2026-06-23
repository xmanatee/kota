import { proposeReviewScrutinyEscalation } from "./review-scrutiny-escalation-tasks.js";
import {
  DEFAULT_REVIEW_SCRUTINY_REPORT_LIMIT,
  type ReviewScrutinyAttentionEntry,
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
  projectDir: string;
  detection: ReviewScrutinyEscalationDetection;
  config?: ReviewScrutinyEscalationConfig;
  limit?: number;
}): ReviewScrutinyEscalationReport {
  const activePatterns: ReviewScrutinyPatternSummary[] = [];
  const cooldownPatterns: ReviewScrutinyPatternSummary[] = [];
  for (const pattern of args.detection.patterns) {
    const proposal = proposeReviewScrutinyEscalation(
      args.projectDir,
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

export function buildReviewScrutinyAttentionDigest(
  entries: ReviewScrutinyAttentionEntry[],
): { items: Array<{ label: string; detail: string }>; text: string } {
  const items = entries.map((entry) => ({
    label: "Review scrutiny escalated",
    detail:
      `${entry.surface} ${entry.workflow}; task ${entry.taskId}; action ${entry.action}; ` +
      `${entry.thinAcceptances}/${entry.approvalLikeDecisions} thin; runs ${entry.runIds.join(", ")}`,
  }));
  const header = `Attention digest (${items.length} item${items.length === 1 ? "" : "s"}):`;
  return {
    items,
    text: [header, ...items.map((item) => `• *${item.label}*: ${item.detail}`)].join("\n"),
  };
}
