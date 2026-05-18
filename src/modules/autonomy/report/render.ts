/**
 * Render the operator-facing autonomy balance report through the rendering
 * primitives. Output is intentionally compact: one heading per dimension,
 * stacked tables/kv blocks, a single short rationale line for explorer
 * classification so the heuristic is auditable on screen.
 */

import {
  blank,
  heading,
  type KVEntry,
  kvBlock,
  line,
  plain,
  type RenderNode,
  span,
  stack,
} from "#modules/rendering/primitives.js";
import type {
  AreaClassification,
  AutonomyReportData,
  BlockerClassMix,
  BuilderBreakdown,
  CostBreakdown,
  ExplorerBalance,
  QueueBalance,
  ReportPriority,
} from "./aggregate.js";

const DOLLARS_DECIMALS = 2;

function fmtUsd(value: number): string {
  return `$${value.toFixed(DOLLARS_DECIMALS)}`;
}

function pct(part: number, whole: number): string {
  if (whole === 0) return "0%";
  return `${Math.round((100 * part) / whole)}%`;
}

function priorityLabel(priority: ReportPriority): string {
  return priority === "unknown" ? "—" : priority;
}

function priorityRole(
  priority: ReportPriority,
): "error" | "warn" | "info" | "muted" {
  switch (priority) {
    case "p0":
      return "error";
    case "p1":
      return "warn";
    case "p2":
      return "info";
    default:
      return "muted";
  }
}

function classificationRole(
  classification: AreaClassification,
): "success" | "warn" | "muted" {
  switch (classification) {
    case "strategic":
      return "success";
    case "fan-out":
      return "warn";
    case "other":
      return "muted";
  }
}

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
    heading("Blockers", 2),
    ...renderBlockers(data.blockers),
    blank(),
    heading("Cost", 2),
    ...renderCost(data.cost),
  );
}

function renderQueueBalance(balance: QueueBalance): RenderNode[] {
  if (balance.total === 0) {
    return [line(span("(none)", "muted"))];
  }
  const priorityEntries: KVEntry[] = balance.byPriority.map((p) => ({
    label: priorityLabel(p.priority),
    value: `${p.count} (${pct(p.count, balance.total)})`,
    role: priorityRole(p.priority),
  }));
  const stateEntries: KVEntry[] = balance.byState.map((s) => ({
    label: s.state,
    value: `${s.count}`,
  }));
  const areaLines = balance.byArea.map((a) =>
    line(plain(`  ${a.area.padEnd(16)} ${String(a.count).padStart(3)} (${pct(a.count, balance.total)})`)),
  );
  const lines: RenderNode[] = [
    line(plain("Total: "), span(String(balance.total), "accent")),
    blank(),
    line(span("By state", "muted", true)),
    kvBlock(stateEntries, 12),
    blank(),
    line(span("By priority", "muted", true)),
    kvBlock(priorityEntries, 12),
    blank(),
    line(span("By area", "muted", true)),
    ...areaLines,
  ];
  if (balance.waitingOnTasks.length > 0) {
    lines.push(blank());
    lines.push(line(span("Waiting on tasks", "muted", true)));
    for (const wait of balance.waitingOnTasks) {
      lines.push(line(
        plain("  "),
        span(wait.taskId, "warn"),
        plain(` (${wait.state}) -> `),
        plain(wait.waitingOn.join(", ")),
      ));
    }
  }
  return lines;
}

function renderExplorerBalance(explorer: ExplorerBalance): RenderNode[] {
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

function renderBuilderBreakdown(builder: BuilderBreakdown): RenderNode[] {
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

function renderBlockers(blockers: BlockerClassMix): RenderNode[] {
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

function blockerRole(
  kind: BlockerClassMix["byKind"][number]["kind"],
): "warn" | "info" | "error" | "muted" {
  switch (kind) {
    case "owner-decision":
      return "warn";
    case "operator-capture":
      return "warn";
    case "capability-installed":
      return "info";
    case "task-done":
      return "info";
    case "missing-section":
      return "error";
    case "malformed":
      return "error";
  }
}

function renderCost(cost: CostBreakdown): RenderNode[] {
  if (cost.finishedRuns === 0) {
    return [line(span("(no finished runs in window)", "muted"))];
  }
  const lines: RenderNode[] = [
    line(
      plain("Total: "),
      span(fmtUsd(cost.totalCostUsd), "accent"),
      plain("   Finished runs: "),
      span(String(cost.finishedRuns), "accent"),
      plain("   Avg/run: "),
      span(fmtUsd(cost.averagePerFinishedRun), "accent"),
    ),
    blank(),
    line(span("By workflow", "muted", true)),
  ];
  const nameWidth = Math.max(8, ...cost.byWorkflow.map((r) => r.workflow.length));
  for (const row of cost.byWorkflow) {
    lines.push(line(plain(
      `  ${row.workflow.padEnd(nameWidth)}  ${String(row.finishedRuns).padStart(4)}   ${fmtUsd(row.totalCostUsd).padStart(9)}   avg ${fmtUsd(row.averageCostUsd).padStart(7)}`,
    )));
  }
  return lines;
}
