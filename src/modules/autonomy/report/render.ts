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
import {
  renderBlockers,
  renderCost,
  renderHealth,
} from "./render-health-sections.js";
import { renderQueueBalance } from "./render-queue.js";
import {
  renderBuilderBreakdown,
  renderExplorerBalance,
  renderReviewScrutiny,
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
    heading("Review scrutiny", 2),
    ...renderReviewScrutiny(data.reviewScrutiny),
    blank(),
    heading("Trajectory diagnostics", 2),
    ...renderTrajectoryDiagnostics(data.trajectoryDiagnostics),
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
