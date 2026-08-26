import {
  blank,
  type KVEntry,
  kvBlock,
  line,
  plain,
  type RenderNode,
  span,
} from "#modules/rendering/primitives.js";
import type {
  AutonomyHealthBreakdown,
  BlockerClassMix,
  CostBreakdown,
} from "./aggregate.js";
import {
  blockerRole,
  fmtUsd,
  healthSeverityRole,
  pct,
} from "./render-common.js";

export function renderHealth(health: AutonomyHealthBreakdown): RenderNode[] {
  if (health.totalSignals === 0) {
    return [line(span("(no health signals)", "muted"))];
  }
  const severityEntries: KVEntry[] = health.bySeverity.map((row) => ({
    label: row.severity,
    value: `${row.count} (${pct(row.count, health.totalSignals)})`,
    role: healthSeverityRole(row.severity),
  }));
  const actionabilityEntries: KVEntry[] = health.byActionability.map((row) => ({
    label: row.actionability,
    value: `${row.count} (${pct(row.count, health.totalSignals)})`,
  }));
  const lines: RenderNode[] = [
    line(
      plain("Signals: "),
      span(String(health.totalSignals), "accent"),
      plain("   Groups: "),
      span(String(health.totalGroups), "accent"),
    ),
    blank(),
    line(span("By severity", "muted", true)),
    kvBlock(severityEntries, 14),
    blank(),
    line(span("By actionability", "muted", true)),
    kvBlock(actionabilityEntries, 18),
    blank(),
    line(span("By lifecycle", "muted", true)),
    kvBlock(
      health.byStatus.map((row) => ({
        label: row.status,
        value: String(row.count),
      })),
      18,
    ),
    blank(),
    line(span("Top labels", "muted", true)),
    ...health.byLabel.slice(0, 8).map((row) =>
      line(plain(`  ${row.label.padEnd(18)} ${String(row.count).padStart(3)} (${pct(row.count, health.totalSignals)})`)),
    ),
    blank(),
    line(span("Top sources", "muted", true)),
    ...health.bySource.slice(0, 8).map((row) =>
      line(plain(`  ${row.source.padEnd(24)} ${String(row.count).padStart(3)} (${pct(row.count, health.totalSignals)})`)),
    ),
  ];
  if (health.byScope.length > 0) {
    lines.push(blank());
    lines.push(line(span("By scope", "muted", true)));
    for (const row of health.byScope.slice(0, 8)) {
      lines.push(line(plain(`  ${row.scope.padEnd(24)} ${String(row.count).padStart(3)} (${pct(row.count, health.totalSignals)})`)));
    }
  }
  if (health.topGroups.length > 0) {
    lines.push(blank());
    lines.push(line(span("Top patterns", "muted", true)));
    for (const group of health.topGroups.slice(0, 6)) {
      lines.push(line(
        plain("  "),
        span(`${String(group.signalCount).padStart(2)}x`, healthSeverityRole(group.severity)),
        plain(" "),
        plain(group.source.padEnd(22)),
        plain(" "),
        span(group.actionability, "info"),
        plain(" "),
        span(group.status, group.status === "resolved" ? "muted" : "warn"),
        plain(" "),
        plain(group.dedupeKey),
      ));
    }
  }
  return lines;
}

export function renderBlockers(blockers: BlockerClassMix): RenderNode[] {
  if (blockers.totalBlocked === 0) {
    return [line(span("(no blocked tasks)", "muted"))];
  }
  const entries: KVEntry[] = blockers.byKind.map((row) => ({
    label: row.kind,
    value: `${row.count} (${pct(row.count, blockers.totalBlocked)})`,
    role: blockerRole(row.kind),
  }));
  return [
    line(plain("Blocked tasks: "), span(String(blockers.totalBlocked), "accent")),
    kvBlock(entries, 22),
  ];
}

export function renderCost(cost: CostBreakdown): RenderNode[] {
  if (cost.finishedRuns === 0) {
    return [line(span("(no finished runs in window)", "muted"))];
  }
  const lines: RenderNode[] = [
    line(
      plain("Measured total: "),
      span(formatMeasuredCost(cost.totalCostUsd), "accent"),
      plain("   Finished runs: "),
      span(String(cost.finishedRuns), "accent"),
      plain("   Avg/measured: "),
      span(formatMeasuredCost(cost.averageMeasuredCostUsd), "accent"),
      plain("   Measured/unavailable/unknown: "),
      span(`${cost.measuredRuns}/${cost.unavailableRuns}/${cost.unknownRuns}`, cost.measuredRuns === cost.finishedRuns ? "accent" : "warn"),
    ),
    blank(),
    line(span("By workflow", "muted", true)),
  ];
  const nameWidth = Math.max(8, ...cost.byWorkflow.map((r) => r.workflow.length));
  for (const row of cost.byWorkflow) {
    lines.push(line(plain(
      `  ${row.workflow.padEnd(nameWidth)}  ${String(row.finishedRuns).padStart(4)}   ${formatMeasuredCost(row.totalCostUsd).padStart(9)}   avg/measured ${formatMeasuredCost(row.averageMeasuredCostUsd).padStart(7)}   measured ${row.measuredRuns} unavailable ${row.unavailableRuns} unknown ${row.unknownRuns}`,
    )));
  }
  return lines;
}

function formatMeasuredCost(costUsd: number | null): string {
  return costUsd === null ? "unknown" : fmtUsd(costUsd);
}
