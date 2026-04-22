import type { Command } from "commander";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import { type LineNode, line, plain, stack } from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import { formatDuration } from "../utils.js";
import { computeHistoryStats, loadRunsInWindow } from "./workflow-history.js";

type StatsRow = {
  workflow: string;
  runs: number;
  successes: number;
  failures: number;
  avgDurationMs: number | null;
  totalCostUsd: number;
};

export function computeStatsRows(
  runsDir: string,
  cutoffMs: number,
  workflowFilter?: string,
): StatsRow[] {
  const allRuns = loadRunsInWindow(runsDir, cutoffMs);
  const filtered = workflowFilter ? allRuns.filter((r) => r.workflow === workflowFilter) : allRuns;
  const wfNames = [...new Set(filtered.map((r) => r.workflow))].sort();
  return wfNames.map((name) => {
    const wfRuns = filtered.filter((r) => r.workflow === name);
    const s = computeHistoryStats(wfRuns);
    return {
      workflow: name,
      runs: s.total,
      successes: s.successes,
      failures: s.failures,
      avgDurationMs: s.avgDurationMs,
      totalCostUsd: s.totalCostUsd,
    };
  });
}

export function buildStatsLines(rows: StatsRow[], days: number): LineNode[] {
  const nameWidth = Math.max(...rows.map((r) => r.workflow.length), 8);
  const header =
    `${"Workflow".padEnd(nameWidth)}  ${"Runs".padStart(5)}  ${"Success".padStart(7)}  ${"Failed".padStart(6)}  ${"Avg Duration".padStart(12)}  ${"Total Cost".padStart(10)}`;
  const lines: LineNode[] = [
    line(plain(header)),
    line(plain("-".repeat(header.length))),
  ];

  for (const row of rows) {
    const avgDur = row.avgDurationMs != null ? formatDuration(Math.round(row.avgDurationMs)) : "—";
    lines.push(line(plain(
      `${row.workflow.padEnd(nameWidth)}  ${String(row.runs).padStart(5)}  ${String(row.successes).padStart(7)}  ${String(row.failures).padStart(6)}  ${avgDur.padStart(12)}  ${`$${row.totalCostUsd.toFixed(3)}`.padStart(10)}`,
    )));
  }

  lines.push(line(plain("")));
  lines.push(line(plain(`(${days}-day window)`)));
  return lines;
}

export function registerStatsCommand(wfCmd: Command): void {
  wfCmd
    .command("stats")
    .description("Show aggregate workflow health: success rate, duration, and cost")
    .option("-w, --workflow <name>", "Filter by workflow name")
    .option("--days <n>", "Lookback window in days", "7")
    .option("--json", "Output as JSON")
    .action((opts: { workflow?: string; days: string; json?: boolean }) => {
      const days = Math.max(1, Number.parseInt(opts.days, 10) || 7);
      const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
      const store = new WorkflowRunStore();
      const rows = computeStatsRows(store.runsDir, cutoffMs, opts.workflow);

      if (opts.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }

      if (rows.length === 0) {
        print(line(plain(`No runs found in the last ${days} day${days === 1 ? "" : "s"}.`)));
        return;
      }

      print(stack(...buildStatsLines(rows, days)));
    });
}
