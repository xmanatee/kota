import type { ReviewScrutinyReport } from "#modules/autonomy/review-scrutiny.js";
import type { ReviewScrutinyEscalationReport } from "#modules/autonomy/review-scrutiny-escalation.js";
import {
  blank,
  line,
  plain,
  type RenderNode,
  span,
} from "#modules/rendering/primitives.js";
import type {
  BuilderBreakdown,
  ExplorerBalance,
  TrajectoryDiagnosticReport,
} from "./aggregate.js";
import {
  classificationRole,
  fmtUsd,
  pct,
  priorityLabel,
  priorityRole,
} from "./render-common.js";

export function renderExplorerBalance(explorer: ExplorerBalance): RenderNode[] {
  if (explorer.totalRuns === 0) {
    return [line(span("(no explorer runs)", "muted"))];
  }
  const lines: RenderNode[] = [
    line(
      plain("Runs: "),
      span(String(explorer.totalRuns), "accent"),
      plain("   Tasks created: "),
      span(String(explorer.totalTaskAdditions), "accent"),
    ),
  ];
  if (explorer.unresolvedTaskAdditions > 0) {
    lines.push(line(span(
      `  ${explorer.unresolvedTaskAdditions} added file(s) could not be resolved to a current task — likely renamed, dropped, or merged.`,
      "muted",
    )));
  }
  lines.push(blank());
  lines.push(line(span("Strategic vs fan-out (by task area)", "muted", true)));
  for (const row of explorer.byClassification) {
    lines.push(line(
      plain(`  ${row.classification.padEnd(10)} `),
      span(
        `${row.tasks} (${pct(row.tasks, explorer.totalTaskAdditions)})`,
        classificationRole(row.classification),
      ),
    ));
  }
  if (explorer.taskAdditions.length > 0) {
    lines.push(blank());
    lines.push(line(span("Task additions", "muted", true)));
    for (const t of explorer.taskAdditions) {
      lines.push(line(
        plain("  "),
        span(t.classification.padEnd(10), classificationRole(t.classification)),
        plain(" "),
        span(priorityLabel(t.priority).padEnd(3), priorityRole(t.priority)),
        plain(" "),
        plain(t.area.padEnd(14)),
        plain(" "),
        plain(t.title),
      ));
    }
  }
  return lines;
}

export function renderBuilderBreakdown(builder: BuilderBreakdown): RenderNode[] {
  if (builder.totalCommittedRuns === 0) {
    return [line(span("(no builder commits)", "muted"))];
  }
  const lines: RenderNode[] = [
    line(
      plain("Committed runs (resolved to a task): "),
      span(String(builder.totalCommittedRuns), "accent"),
    ),
  ];
  if (builder.unresolvedClosures > 0) {
    lines.push(line(span(
      `  ${builder.unresolvedClosures} builder commit(s) could not be linked to a current task.`,
      "muted",
    )));
  }
  lines.push(blank());
  lines.push(line(span("By area", "muted", true)));
  for (const row of builder.byArea) {
    lines.push(line(plain(
      `  ${row.area.padEnd(16)} ${String(row.commits).padStart(3)}   ${fmtUsd(row.totalCostUsd).padStart(8)}`,
    )));
  }
  lines.push(blank());
  lines.push(line(span("By priority", "muted", true)));
  for (const row of builder.byPriority) {
    lines.push(line(
      plain("  "),
      span(priorityLabel(row.priority).padEnd(4), priorityRole(row.priority)),
      plain(`   ${String(row.commits).padStart(3)}   ${fmtUsd(row.totalCostUsd).padStart(8)}`),
    ));
  }
  lines.push(blank());
  lines.push(line(span("Strategic vs fan-out", "muted", true)));
  for (const row of builder.byClassification) {
    lines.push(line(
      plain("  "),
      span(row.classification.padEnd(10), classificationRole(row.classification)),
      plain(` ${String(row.commits).padStart(3)}   ${fmtUsd(row.totalCostUsd).padStart(8)} (${pct(row.commits, builder.totalCommittedRuns)})`),
    ));
  }
  return lines;
}

export function renderReviewScrutiny(report: ReviewScrutinyReport): RenderNode[] {
  if (report.totalReviews === 0 && report.unsupportedArtifacts === 0) {
    return [line(span("(no reviewer artifacts)", "muted"))];
  }
  const lines: RenderNode[] = [
    line(
      plain("Reviews: "),
      span(String(report.totalReviews), "accent"),
      plain("   Approval-like: "),
      span(String(report.approvalLikeDecisions), "accent"),
      plain("   Thin acceptances: "),
      span(String(report.thinAcceptances), report.thinAcceptances > 0 ? "warn" : "accent"),
      plain("   Absent metrics: "),
      span(String(report.absentMetricCount), report.absentMetricCount > 0 ? "warn" : "accent"),
      plain("   Unsupported: "),
      span(String(report.unsupportedArtifacts), report.unsupportedArtifacts > 0 ? "warn" : "accent"),
    ),
    blank(),
    line(span("By surface", "muted", true)),
  ];
  for (const row of report.bySurface) {
    if (
      row.reviews === 0 &&
      row.approvalLikeDecisions === 0 &&
      row.thinAcceptances === 0 &&
      row.absentMetricCount === 0 &&
      row.unsupportedArtifacts === 0
    ) {
      continue;
    }
    lines.push(line(plain(
      `  ${row.surface.padEnd(17)} ${String(row.reviews).padStart(3)} reviews   ${String(row.approvalLikeDecisions).padStart(3)} approval-like   ${String(row.thinAcceptances).padStart(3)} thin   ${String(row.absentMetricCount).padStart(3)} absent   ${String(row.unsupportedArtifacts).padStart(3)} unsupported`,
    )));
  }
  if (report.absentMetricRefs.length > 0) {
    lines.push(blank());
    lines.push(line(span("Absent metric refs", "muted", true)));
    for (const ref of report.absentMetricRefs.slice(0, 8)) {
      const target = ref.pr
        ? `${ref.pr.repo}#${ref.pr.number}`
        : ref.taskId ?? ref.artifact;
      lines.push(line(
        plain("  "),
        span(ref.surface.padEnd(17), "warn"),
        plain(" "),
        plain(ref.runId),
        plain(" "),
        span(target, "muted"),
        plain(" "),
        span(ref.metrics.join(","), "muted"),
      ));
    }
  }
  if (report.thinAcceptanceRefs.length > 0) {
    lines.push(blank());
    lines.push(line(span("Thin acceptance refs", "muted", true)));
    for (const ref of report.thinAcceptanceRefs.slice(0, 8)) {
      const target = ref.pr
        ? `${ref.pr.repo}#${ref.pr.number}`
        : ref.taskId ?? ref.artifact;
      lines.push(line(
        plain("  "),
        span(ref.surface.padEnd(17), "warn"),
        plain(" "),
        span(ref.decision.padEnd(18), "warn"),
        plain(" "),
        plain(ref.runId),
        plain(" "),
        span(target, "muted"),
      ));
    }
  }
  return lines;
}

export function renderReviewScrutinyEscalation(
  report: ReviewScrutinyEscalationReport,
): RenderNode[] {
  if (
    report.activePatterns.length === 0 &&
    report.cooldownPatterns.length === 0 &&
    report.belowThresholdPatterns.length === 0
  ) {
    return [line(span("(no recurring thin-acceptance patterns)", "muted"))];
  }
  const lines: RenderNode[] = [];
  if (report.activePatterns.length > 0) {
    lines.push(line(span("Active patterns", "muted", true)));
    for (const pattern of report.activePatterns) {
      lines.push(line(
        plain("  "),
        span(`${pattern.surface}`.padEnd(17), "warn"),
        plain(" "),
        plain(`${pattern.workflow} ${pattern.taskArea}/${pattern.taskClass}`.padEnd(32)),
        plain(" "),
        span(`${pattern.thinAcceptances}/${pattern.approvalLikeDecisions}`, "warn"),
        plain(" -> "),
        span(pattern.repairTaskId, "accent"),
      ));
    }
  }
  if (report.cooldownPatterns.length > 0) {
    if (lines.length > 0) lines.push(blank());
    lines.push(line(span("Cooldown-suppressed patterns", "muted", true)));
    for (const pattern of report.cooldownPatterns) {
      lines.push(line(
        plain("  "),
        span(pattern.surface.padEnd(17), "warn"),
        plain(" "),
        plain(`${pattern.workflow} ${pattern.taskArea}/${pattern.taskClass}`.padEnd(32)),
        plain(" "),
        span(pattern.repairTaskId, "muted"),
      ));
    }
  }
  if (report.belowThresholdPatterns.length > 0) {
    if (lines.length > 0) lines.push(blank());
    lines.push(line(span("Below-threshold patterns", "muted", true)));
    for (const pattern of report.belowThresholdPatterns) {
      lines.push(line(
        plain("  "),
        plain(pattern.surface.padEnd(17)),
        plain(" "),
        plain(`${pattern.workflow} ${pattern.taskArea}/${pattern.taskClass}`.padEnd(32)),
        plain(" "),
        span(
          `${pattern.thinAcceptances}/${pattern.approvalLikeDecisions} thin`,
          "muted",
        ),
      ));
    }
  }
  return lines;
}

export function renderTrajectoryDiagnostics(
  report: TrajectoryDiagnosticReport,
): RenderNode[] {
  if (report.activePatterns.length === 0) {
    return [line(span("(no recurring trajectory diagnostic patterns)", "muted"))];
  }
  const lines: RenderNode[] = [
    line(span("Top active patterns", "muted", true)),
  ];
  for (const pattern of report.activePatterns) {
    lines.push(line(
      plain("  "),
      span(`${String(pattern.runCount).padStart(2)}x`, "warn"),
      plain(" "),
      plain(`${pattern.workflow}/${pattern.stepId}`.padEnd(30)),
      plain(" "),
      span(pattern.code, "info"),
      plain(" -> "),
      span(pattern.repairTaskId, "accent"),
    ));
  }
  return lines;
}
