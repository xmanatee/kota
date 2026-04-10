import type { Command } from "commander";
import { WorkflowRunStore } from "../../core/workflow/run-store.js";
import { DaemonControlClient } from "../../core/server/daemon-client.js";
import { formatDate } from "./utils.js";
import { loadRunsInWindow } from "./workflow-history.js";

type RunCostEntry = {
  id: string;
  workflow: string;
  status: string;
  startedAt: string;
  totalCostUsd?: number;
};

export type WorkflowCostRow = {
  workflow: string;
  runs: number;
  totalCostUsd: number;
  averageCostUsd: number;
  maxRunCostUsd: number;
};

export function computeWorkflowCostRows(runs: RunCostEntry[]): WorkflowCostRow[] {
  const byWf = new Map<string, { runs: number; totalCostUsd: number; maxRunCostUsd: number }>();
  for (const run of runs) {
    if (run.status === "running") continue;
    const cost = run.totalCostUsd ?? 0;
    const existing = byWf.get(run.workflow);
    if (existing) {
      existing.runs += 1;
      existing.totalCostUsd += cost;
      if (cost > existing.maxRunCostUsd) existing.maxRunCostUsd = cost;
    } else {
      byWf.set(run.workflow, { runs: 1, totalCostUsd: cost, maxRunCostUsd: cost });
    }
  }
  return [...byWf.entries()]
    .map(([workflow, agg]) => ({
      workflow,
      runs: agg.runs,
      totalCostUsd: agg.totalCostUsd,
      averageCostUsd: agg.runs > 0 ? agg.totalCostUsd / agg.runs : 0,
      maxRunCostUsd: agg.maxRunCostUsd,
    }))
    .sort((a, b) => b.totalCostUsd - a.totalCostUsd);
}

function printSummaryTable(rows: WorkflowCostRow[]): void {
  if (rows.length === 0) return;
  const nameWidth = Math.max(...rows.map((r) => r.workflow.length), 8);
  const header =
    `${"Workflow".padEnd(nameWidth)}  ${"Total".padStart(10)}  ${"Runs".padStart(5)}  ${"Avg/run".padStart(9)}  ${"Max run".padStart(9)}`;
  console.log(header);
  console.log("-".repeat(header.length));
  for (const row of rows) {
    const name = row.workflow.padEnd(nameWidth);
    const total = `$${row.totalCostUsd.toFixed(4)}`.padStart(10);
    const count = String(row.runs).padStart(5);
    const avg = `$${row.averageCostUsd.toFixed(4)}`.padStart(9);
    const max = `$${row.maxRunCostUsd.toFixed(4)}`.padStart(9);
    console.log(`${name}  ${total}  ${count}  ${avg}  ${max}`);
  }
}

function printRunBreakdown(runs: RunCostEntry[]): void {
  const finished = runs.filter((r) => r.status !== "running");
  if (finished.length === 0) {
    console.log("  (no completed runs)");
    return;
  }
  const sorted = [...finished].sort((a, b) => (b.totalCostUsd ?? 0) - (a.totalCostUsd ?? 0));
  for (const run of sorted) {
    const cost = run.totalCostUsd != null ? `$${run.totalCostUsd.toFixed(4)}` : "—";
    const when = formatDate(run.startedAt);
    console.log(`  ${run.id}  ${cost.padStart(9)}  ${when}  ${run.status}`);
  }
}

async function loadRuns(
  store: WorkflowRunStore,
  cutoffMs: number,
  workflowFilter?: string,
): Promise<RunCostEntry[]> {
  const daemonClient = DaemonControlClient.fromStateDir();
  if (daemonClient) {
    const result = await daemonClient.listWorkflowRuns(workflowFilter, 1000);
    if (result) {
      return result.runs
        .filter((r) => new Date(r.startedAt).getTime() >= cutoffMs)
        .map((r) => ({
          id: r.id,
          workflow: r.workflow,
          status: r.status,
          startedAt: r.startedAt,
          totalCostUsd: r.totalCostUsd,
        }));
    }
  }
  const allRuns = loadRunsInWindow(store.runsDir, cutoffMs);
  const filtered = workflowFilter ? allRuns.filter((r) => r.workflow === workflowFilter) : allRuns;
  return filtered.map((r) => ({
    id: r.id,
    workflow: r.workflow,
    status: r.status,
    startedAt: r.startedAt,
    totalCostUsd: r.totalCostUsd,
  }));
}

export function registerCostCommand(wfCmd: Command): void {
  wfCmd
    .command("cost")
    .description("Show per-workflow cost ranked by total spend")
    .option("-w, --workflow <name>", "Drill into one workflow with per-run breakdown")
    .option("--days <n>", "Lookback window in days", "7")
    .option("--json", "Output as JSON")
    .action(async (opts: { workflow?: string; days: string; json?: boolean }) => {
      const days = Math.max(1, Number.parseInt(opts.days, 10) || 7);
      const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
      const store = new WorkflowRunStore();
      const runs = await loadRuns(store, cutoffMs, opts.workflow);
      const rows = computeWorkflowCostRows(runs);
      const finished = runs.filter((r) => r.status !== "running");
      const grandTotal = finished.reduce((s, r) => s + (r.totalCostUsd ?? 0), 0);

      if (opts.json) {
        console.log(JSON.stringify(
          { days, totalCostUsd: grandTotal, runCount: finished.length, workflows: rows },
          null,
          2,
        ));
        return;
      }

      if (rows.length === 0) {
        console.log(`No runs found in the last ${days} day${days === 1 ? "" : "s"}.`);
        return;
      }

      console.log(`Last ${days} day${days === 1 ? "" : "s"} — $${grandTotal.toFixed(4)} total across ${finished.length} run${finished.length === 1 ? "" : "s"}\n`);
      printSummaryTable(rows);

      if (opts.workflow) {
        console.log(`\nPer-run breakdown — ${opts.workflow}:`);
        printRunBreakdown(runs);
      }
    });
}
