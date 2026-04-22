import type { Command } from "commander";
import { DaemonControlClient } from "#core/server/daemon-client.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { blank, type LineNode, line, plain, type RenderNode, stack } from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import { formatDate, formatDuration, listRuns, statusIcon } from "../utils.js";
import type { HistoryStats } from "./workflow-history.js";
import { computeHistoryStats, loadRunsInWindow } from "./workflow-history.js";

type RunRow = {
  id: string;
  workflow: string;
  status: string;
  durationMs?: number;
  totalCostUsd?: number;
  startedAt: string;
  trigger: { event: string };
  retryOf?: string;
  triggeredByRunId?: string;
  tags?: string[];
};

export function registerRunListCommands(wfCmd: Command): void {
  wfCmd
    .command("list")
    .description("List recent workflow runs")
    .option("-n, --limit <n>", "Number of runs to show", "20")
    .option("-w, --workflow <name>", "Filter by workflow name")
    .option("-s, --status <status>", "Filter by run status (success, failed, interrupted, completed-with-warnings, running)")
    .option("-t, --tag <tag>", "Filter by tag")
    .option("--caused-by <run-id>", "Filter by upstream run ID (show runs triggered by this run)")
    .action(async (opts) => {
      const validStatuses = ["success", "failed", "interrupted", "completed-with-warnings", "running"];
      if (opts.status && !validStatuses.includes(opts.status)) {
        console.error(`Unknown status "${opts.status}". Valid values: ${validStatuses.join(", ")}`);
        process.exit(1);
      }
      const limit = Number.parseInt(opts.limit, 10) || 20;
      const causedByRunId = opts.causedBy as string | undefined;

      let page: RunRow[];
      const store = new WorkflowRunStore();

      const daemonClient = DaemonControlClient.fromStateDir();
      const daemonRuns = daemonClient ? await daemonClient.listWorkflowRuns(opts.workflow, limit * 3, undefined, causedByRunId) : null;

      if (daemonRuns) {
        const filtered = daemonRuns.runs
          .filter((r) => !opts.status || r.status === opts.status)
          .filter((r) => !opts.tag || (r.tags ?? []).includes(opts.tag as string));
        page = filtered.slice(0, limit).map((r) => ({
          id: r.id,
          workflow: r.workflow,
          status: r.status,
          durationMs: r.durationMs,
          totalCostUsd: r.totalCostUsd,
          startedAt: r.startedAt,
          trigger: { event: r.triggerEvent },
          retryOf: r.retryOf,
          triggeredByRunId: r.triggeredByRunId,
          tags: r.tags,
        }));
      } else {
        const runs = causedByRunId
          ? store.listRuns({ causedByRunId, limit: limit * 3 })
          : listRuns(store, limit * 3);
        const filtered = runs
          .filter((r) => !opts.workflow || r.workflow === opts.workflow)
          .filter((r) => !opts.status || r.status === opts.status)
          .filter((r) => !opts.tag || (r.tags ?? []).includes(opts.tag as string));
        page = filtered.slice(0, limit);
      }

      if (page.length === 0) {
        print(line(plain("No runs found.")));
        return;
      }
      print(stack(...buildRunListLines(page)));
    });

  wfCmd
    .command("history")
    .description("Show aggregate run stats grouped by workflow")
    .option("-w, --workflow <name>", "Filter to a single workflow")
    .option("--days <n>", "Time window in days", "7")
    .action((opts: { workflow?: string; days: string }) => {
      const days = Number.parseInt(opts.days, 10) || 7;
      const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
      const store = new WorkflowRunStore();
      const runs = loadRunsInWindow(store.runsDir, cutoffMs);
      const filtered = opts.workflow ? runs.filter((r) => r.workflow === opts.workflow) : runs;

      if (filtered.length === 0) {
        print(line(plain(`No runs found in the last ${days} day${days === 1 ? "" : "s"}.`)));
        return;
      }

      const wfNames = opts.workflow
        ? [opts.workflow]
        : [...new Set(filtered.map((r) => r.workflow))].sort();

      const wfRows: Array<{ name: string; stats: HistoryStats }> = wfNames.map((name) => ({
        name,
        stats: computeHistoryStats(filtered.filter((r) => r.workflow === name)),
      }));

      const totals = wfNames.length > 1
        ? computeHistoryTotals(wfRows.map((r) => r.stats), filtered)
        : null;

      const completedCount = filtered.filter((r) => r.status !== "running").length;
      print(stack(...buildHistoryLines(wfRows, totals, days, completedCount)));
    });
}

function buildRunListLines(page: RunRow[]): LineNode[] {
  const idWidth = 42;
  const wfWidth = 12;
  const stWidth = 4;
  const durWidth = 8;
  const costWidth = 8;
  const dateWidth = 18;

  const header = line(plain(
    `${"ID".padEnd(idWidth)} ${"Workflow".padEnd(wfWidth)} ${"St".padEnd(stWidth)} ${"Duration".padEnd(durWidth)} ${"Cost".padEnd(costWidth)} ${"Started".padEnd(dateWidth)} Trigger`,
  ));
  const rule = line(plain("-".repeat(120)));

  const rows: LineNode[] = page.map((r) => {
    const id = r.id.padEnd(idWidth);
    const wf = r.workflow.padEnd(wfWidth);
    const st = statusIcon(r.status).padEnd(stWidth);
    const dur = (r.durationMs != null ? formatDuration(r.durationMs) : "…").padEnd(durWidth);
    const cost = (r.totalCostUsd != null ? `$${r.totalCostUsd.toFixed(3)}` : "—").padEnd(costWidth);
    const started = formatDate(r.startedAt).padEnd(dateWidth);
    const trigger = r.retryOf
      ? `retry ← ${r.retryOf}`
      : r.triggeredByRunId
      ? `${r.trigger.event} ← ${r.triggeredByRunId}`
      : r.trigger.event;
    const tagStr = r.tags && r.tags.length > 0 ? ` [${r.tags.join(",")}]` : "";
    return line(plain(`${id} ${wf} ${st} ${dur} ${cost} ${started} ${trigger}${tagStr}`));
  });

  return [header, rule, ...rows];
}

export type HistoryTotals = {
  total: number;
  successes: number;
  failures: number;
  interrupted: number;
  totalCostUsd: number;
  successRate: number;
  avgCostUsd: number;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
};

export function computeHistoryTotals(
  stats: HistoryStats[],
  filteredRuns: Array<{ status: string; durationMs?: number }>,
): HistoryTotals {
  const acc = stats.reduce(
    (a, s) => ({
      total: a.total + s.total,
      successes: a.successes + s.successes,
      failures: a.failures + s.failures,
      interrupted: a.interrupted + s.interrupted,
      totalCostUsd: a.totalCostUsd + s.totalCostUsd,
    }),
    { total: 0, successes: 0, failures: 0, interrupted: 0, totalCostUsd: 0 },
  );
  const successRate = acc.total > 0 ? (acc.successes / acc.total) * 100 : 0;
  const avgCostUsd = acc.total > 0 ? acc.totalCostUsd / acc.total : 0;
  const durations = filteredRuns
    .filter((r) => r.status !== "running" && r.durationMs != null)
    .map((r) => r.durationMs as number)
    .sort((a, b) => a - b);
  const avgDurationMs = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : null;
  const p95DurationMs = durations.length > 0
    ? durations[Math.ceil(0.95 * durations.length) - 1]
    : null;
  return { ...acc, successRate, avgCostUsd, avgDurationMs, p95DurationMs };
}

export function buildHistoryLines(
  wfRows: Array<{ name: string; stats: HistoryStats }>,
  totals: HistoryTotals | null,
  days: number,
  completedCount: number,
): RenderNode[] {
  const nameWidth = Math.max(...wfRows.map((r) => r.name.length), 8);
  const headerStr = `${"Workflow".padEnd(nameWidth)}  ${"Runs".padStart(5)}  ${"OK".padStart(4)}  ${"Fail".padStart(4)}  ${"Int".padStart(3)}  ${"Rate".padStart(6)}  ${"TotalCost".padStart(10)}  ${"AvgCost".padStart(8)}  ${"AvgDur".padStart(8)}  ${"P95Dur".padStart(8)}`;
  const lines: RenderNode[] = [
    line(plain(headerStr)),
    line(plain("-".repeat(headerStr.length))),
  ];

  for (const { name, stats: s } of wfRows) {
    const avgDur = s.avgDurationMs != null ? formatDuration(Math.round(s.avgDurationMs)) : "—";
    const p95Dur = s.p95DurationMs != null ? formatDuration(s.p95DurationMs) : "—";
    lines.push(line(plain(
      `${name.padEnd(nameWidth)}  ${String(s.total).padStart(5)}  ${String(s.successes).padStart(4)}  ${String(s.failures).padStart(4)}  ${String(s.interrupted).padStart(3)}  ${`${s.successRate.toFixed(1)}%`.padStart(6)}  ${`$${s.totalCostUsd.toFixed(3)}`.padStart(10)}  ${`$${s.avgCostUsd.toFixed(3)}`.padStart(8)}  ${avgDur.padStart(8)}  ${p95Dur.padStart(8)}`,
    )));
  }

  if (totals) {
    const avgDur = totals.avgDurationMs != null ? formatDuration(Math.round(totals.avgDurationMs)) : "—";
    const p95Dur = totals.p95DurationMs != null ? formatDuration(totals.p95DurationMs) : "—";
    lines.push(line(plain("-".repeat(headerStr.length))));
    lines.push(line(plain(
      `${"TOTAL".padEnd(nameWidth)}  ${String(totals.total).padStart(5)}  ${String(totals.successes).padStart(4)}  ${String(totals.failures).padStart(4)}  ${String(totals.interrupted).padStart(3)}  ${`${totals.successRate.toFixed(1)}%`.padStart(6)}  ${`$${totals.totalCostUsd.toFixed(3)}`.padStart(10)}  ${`$${totals.avgCostUsd.toFixed(3)}`.padStart(8)}  ${avgDur.padStart(8)}  ${p95Dur.padStart(8)}`,
    )));
  }

  lines.push(blank());
  lines.push(line(plain(`(${days}-day window, ${completedCount} completed runs)`)));
  return lines;
}
