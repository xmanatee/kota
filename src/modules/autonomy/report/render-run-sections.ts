import type { ReviewOutcomeReport } from "#modules/autonomy/review-outcomes.js";
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
  fmtUsd,
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
  if (explorer.taskAdditions.length > 0) {
    lines.push(blank());
    lines.push(line(span("Task additions", "muted", true)));
    for (const t of explorer.taskAdditions) {
      lines.push(line(
        plain("  "),
        span(priorityLabel(t.priority).padEnd(3), priorityRole(t.priority)),
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
  lines.push(line(span("By priority", "muted", true)));
  for (const row of builder.byPriority) {
    lines.push(line(
      plain("  "),
      span(priorityLabel(row.priority).padEnd(4), priorityRole(row.priority)),
      plain(`   ${formatBuilderCostRow(row)}`),
    ));
  }
  return lines;
}

function formatBuilderCost(costUsd: number | null): string {
  return costUsd === null ? "unknown" : fmtUsd(costUsd);
}

function formatBuilderCostRow(row: {
  commits: number;
  measuredCostRuns: number;
  unavailableCostRuns: number;
  unknownCostRuns: number;
  totalCostUsd: number | null;
}): string {
  return `${String(row.commits).padStart(3)}   ${formatBuilderCost(row.totalCostUsd).padStart(8)}   measured ${row.measuredCostRuns} unavailable ${row.unavailableCostRuns} unknown ${row.unknownCostRuns}`;
}

export function renderReviewOutcome(report: ReviewOutcomeReport): RenderNode[] {
  if (report.totalReviews === 0 && report.unsupportedArtifacts === 0) {
    return [line(span("(no reviewer artifacts)", "muted"))];
  }
  return [
    line(plain(`Reviews: ${report.totalReviews}   Approval-like: ${report.approvalLikeDecisions}   Unreadable artifacts: ${report.unsupportedArtifacts}`)),
    ...report.bySurface.filter((row) => row.reviews > 0 || row.unsupportedArtifacts > 0)
      .map((row) => line(plain(`  ${row.surface}: ${row.reviews} reviews, ${row.approvalLikeDecisions} approval-like, ${row.unsupportedArtifacts} unreadable`))),
  ];
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
    ));
  }
  return lines;
}
