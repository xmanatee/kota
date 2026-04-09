import type { Command } from "commander";
import { WorkflowRunStore } from "../../workflow/run-store.js";
import type { WorkflowRunMetadata } from "../../workflow/run-types.js";
import { loadRunsInWindow } from "../../workflow-history.js";
import { formatDate } from "./utils.js";

type DayEntry = {
  date: string; // YYYY-MM-DD UTC
  runs: WorkflowRunMetadata[];
};

type WorkflowCostRow = {
  workflow: string;
  runs: number;
  totalCostUsd: number;
};

function groupByDay(runs: WorkflowRunMetadata[]): DayEntry[] {
  const byDay = new Map<string, WorkflowRunMetadata[]>();
  for (const run of runs) {
    const date = (run.completedAt ?? run.startedAt).slice(0, 10);
    const existing = byDay.get(date);
    if (existing) {
      existing.push(run);
    } else {
      byDay.set(date, [run]);
    }
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, dayRuns]) => ({ date, runs: dayRuns }));
}

function computeWorkflowRows(runs: WorkflowRunMetadata[]): WorkflowCostRow[] {
  const byWf = new Map<string, WorkflowCostRow>();
  for (const run of runs) {
    if (run.status === "running") continue;
    const row = byWf.get(run.workflow) ?? { workflow: run.workflow, runs: 0, totalCostUsd: 0 };
    row.runs += 1;
    row.totalCostUsd += run.totalCostUsd ?? 0;
    byWf.set(run.workflow, row);
  }
  return [...byWf.values()].sort((a, b) => b.totalCostUsd - a.totalCostUsd);
}

function printWorkflowBreakdown(rows: WorkflowCostRow[], indent = "  "): void {
  if (rows.length === 0) return;
  const nameWidth = Math.max(...rows.map((r) => r.workflow.length), 8);
  for (const row of rows) {
    const name = row.workflow.padEnd(nameWidth);
    const cost = `$${row.totalCostUsd.toFixed(4)}`.padStart(10);
    const count = `${row.runs} run${row.runs === 1 ? "" : "s"}`.padStart(8);
    console.log(`${indent}${name} ${cost}  ${count}`);
  }
}

function printRunDetail(runs: WorkflowRunMetadata[], indent = "    "): void {
  const finished = runs.filter((r) => r.status !== "running");
  for (const run of finished) {
    const cost = run.totalCostUsd != null ? `$${run.totalCostUsd.toFixed(4)}` : "—";
    const when = formatDate(run.startedAt);
    console.log(`${indent}${run.id}  ${cost.padStart(9)}  ${when}  ${run.status}`);
  }
}

function printJsonOutput(days: DayEntry[], workflowFilter: string | undefined): void {
  const output = days.map(({ date, runs }) => {
    const filtered = workflowFilter ? runs.filter((r) => r.workflow === workflowFilter) : runs;
    const finished = filtered.filter((r) => r.status !== "running");
    const totalCostUsd = finished.reduce((s, r) => s + (r.totalCostUsd ?? 0), 0);
    const byWorkflow = computeWorkflowRows(finished);
    return { date, totalCostUsd, workflows: byWorkflow, runCount: finished.length };
  });
  console.log(JSON.stringify(output, null, 2));
}

export function registerCostCommand(wfCmd: Command): void {
  wfCmd
    .command("cost")
    .description("Show workflow cost by day and workflow")
    .option("-w, --workflow <name>", "Filter by workflow name")
    .option("--days <n>", "Lookback window in days", "7")
    .option("--runs", "Show per-run detail within each day")
    .option("--json", "Output as JSON")
    .action((opts: { workflow?: string; days: string; runs?: boolean; json?: boolean }) => {
      const days = Math.max(1, Number.parseInt(opts.days, 10) || 7);
      const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
      const store = new WorkflowRunStore();
      const allRuns = loadRunsInWindow(store.runsDir, cutoffMs);
      const filtered = opts.workflow ? allRuns.filter((r) => r.workflow === opts.workflow) : allRuns;

      const dayGroups = groupByDay(filtered);

      if (opts.json) {
        printJsonOutput(dayGroups, opts.workflow);
        return;
      }

      if (dayGroups.length === 0) {
        console.log(`No runs found in the last ${days} day${days === 1 ? "" : "s"}.`);
        return;
      }

      // Per-day section
      for (const { date, runs: dayRuns } of dayGroups) {
        const finished = dayRuns.filter((r) => r.status !== "running");
        const total = finished.reduce((s, r) => s + (r.totalCostUsd ?? 0), 0);
        const label = (() => {
          const today = new Date().toISOString().slice(0, 10);
          const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
          if (date === today) return `${date}  (today)`;
          if (date === yesterday) return `${date}  (yesterday)`;
          return date;
        })();
        console.log(`${label}  total $${total.toFixed(4)}  (${finished.length} run${finished.length === 1 ? "" : "s"})`);
        const wfRows = computeWorkflowRows(dayRuns);
        printWorkflowBreakdown(wfRows);
        if (opts.runs) {
          printRunDetail(finished);
        }
      }

      // Rolling total
      const finishedAll = filtered.filter((r) => r.status !== "running");
      const grandTotal = finishedAll.reduce((s, r) => s + (r.totalCostUsd ?? 0), 0);
      console.log(`\n${days}-day total  $${grandTotal.toFixed(4)}  (${finishedAll.length} run${finishedAll.length === 1 ? "" : "s"})`);
      if (!opts.workflow) {
        const allWfRows = computeWorkflowRows(finishedAll);
        printWorkflowBreakdown(allWfRows);
      }
    });
}
