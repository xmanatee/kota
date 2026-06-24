/**
 * Render the operator-facing autonomy balance report through the rendering
 * primitives. Output is intentionally compact: one heading per dimension,
 * stacked tables/kv blocks, a single short rationale line for explorer
 * classification so the heuristic is auditable on screen.
 */

import {
  blank,
  heading,
  line,
  plain,
  type RenderNode,
  span,
  stack,
} from "#modules/rendering/primitives.js";
import type { AutonomyReportData } from "./aggregate.js";
import { renderCodeHealthDrift } from "./render-code-health-drift.js";
import { renderDiffSummaryConsistency } from "./render-diff-summary-consistency.js";
import {
  renderBlockers,
  renderCost,
  renderHealth,
} from "./render-health-sections.js";
import { renderOwnerInterventions } from "./render-owner-interventions.js";
import { renderPostCompletionFollowUps } from "./render-post-completion-followups.js";
import { renderQualityStratification } from "./render-quality-stratification.js";
import { renderQueueBalance } from "./render-queue.js";
import {
  renderBuilderBreakdown,
  renderExplorerBalance,
  renderReviewScrutiny,
  renderReviewScrutinyEscalation,
  renderTrajectoryDiagnostics,
} from "./render-run-sections.js";

export function renderAutonomyReport(data: AutonomyReportData): RenderNode {
  return stack(
    line(
      plain("Autonomy report — last "),
      span(`${data.windowDays} day${data.windowDays === 1 ? "" : "s"}`, "accent"),
      plain(" ("),
      span(`${data.windowStartedAt.slice(0, 10)} → ${data.windowEndedAt.slice(0, 10)}`, "muted"),
      plain(")"),
    ),
    blank(),
    heading("Open queue", 2),
    ...renderQueueBalance(data.openQueue),
    blank(),
    heading("Tasks moved to done in window", 2),
    ...renderQueueBalance(data.doneInWindow),
    blank(),
    heading("Explorer output", 2),
    ...renderExplorerBalance(data.explorer),
    blank(),
    heading("Builder breakdown", 2),
    ...renderBuilderBreakdown(data.builder),
    blank(),
    heading("Diff-summary consistency", 2),
    ...renderDiffSummaryConsistency(data.diffSummaryConsistency),
    blank(),
    heading("Code-health drift", 2),
    ...renderCodeHealthDrift(data.codeHealthDrift),
    blank(),
    heading("Owner interventions", 2),
    ...renderOwnerInterventions(data.ownerInterventions),
    blank(),
    heading("Review scrutiny", 2),
    ...renderReviewScrutiny(data.reviewScrutiny),
    blank(),
    heading("Review scrutiny escalation", 2),
    ...renderReviewScrutinyEscalation(data.reviewScrutinyEscalation),
    blank(),
    heading("Trajectory diagnostics", 2),
    ...renderTrajectoryDiagnostics(data.trajectoryDiagnostics),
    blank(),
    heading("Post-completion follow-ups", 2),
    ...renderPostCompletionFollowUps(data.postCompletionFollowUps),
    blank(),
    heading("Quality stratification", 2),
    ...renderQualityStratification(data.qualityStratification),
    blank(),
    heading("Autonomy health", 2),
    ...renderHealth(data.health),
    blank(),
    heading("Blockers", 2),
    ...renderBlockers(data.blockers),
    blank(),
    heading("Cost", 2),
    ...renderCost(data.cost),
  );
}
