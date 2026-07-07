import {
  blank,
  line,
  plain,
  type RenderNode,
  span,
} from "#modules/rendering/primitives.js";
import type {
  AutonomyChangeDecisionReport,
  AutonomyChangeDecisionSummary,
} from "./aggregate.js";

function decisionRole(
  decision: AutonomyChangeDecisionSummary["decision"],
): "success" | "warn" | "error" | "info" {
  switch (decision) {
    case "promote":
      return "success";
    case "rollback":
      return "error";
    case "hold":
      return "warn";
    case "needs-more-data":
      return "info";
  }
}

function metricSummary(decision: AutonomyChangeDecisionSummary): string {
  return decision.metricsCompared
    .slice(0, 3)
    .map(
      (metric) =>
        `${metric.name}: ${metric.baseline} -> ${metric.candidate} (${metric.direction})`,
    )
    .join("; ");
}

export function renderAutonomyChangeDecisions(
  report: AutonomyChangeDecisionReport,
): RenderNode[] {
  if (report.totalDecisions === 0 && report.invalidArtifacts.length === 0) {
    return [line(span("(no autonomy change decisions)", "muted"))];
  }

  const lines: RenderNode[] = [
    line(
      plain("Decisions: "),
      span(String(report.totalDecisions), "accent"),
      plain("   Invalid artifacts: "),
      span(
        String(report.invalidArtifacts.length),
        report.invalidArtifacts.length > 0 ? "warn" : "accent",
      ),
    ),
  ];

  if (report.decisions.length > 0) {
    lines.push(blank());
    lines.push(line(span("Latest decisions", "muted", true)));
    for (const decision of report.decisions.slice(0, 8)) {
      lines.push(
        line(
          plain("  "),
          span(decision.decision.padEnd(16), decisionRole(decision.decision)),
          plain(" "),
          span(decision.rolloutMode.padEnd(12), "info"),
          plain(" "),
          plain(decision.runId),
          plain(" "),
          span(decision.changeClasses.join(","), "muted"),
        ),
      );
      lines.push(
        line(
          plain("    refs "),
          span(`baseline=${decision.baselineRefs.join(",")}`, "muted"),
          plain(" "),
          span(`candidate=${decision.candidateRefs.join(",")}`, "muted"),
        ),
      );
      lines.push(line(plain("    metrics "), span(metricSummary(decision), "muted")));
      lines.push(line(plain("    rationale "), plain(decision.rationale)));
    }
  }

  if (report.invalidArtifacts.length > 0) {
    lines.push(blank());
    lines.push(line(span("Invalid artifacts", "muted", true)));
    for (const invalid of report.invalidArtifacts.slice(0, 8)) {
      lines.push(
        line(
          plain("  "),
          span(invalid.runId, "warn"),
          plain(" "),
          span(invalid.reason, "muted"),
        ),
      );
    }
  }

  return lines;
}
