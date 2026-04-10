import type { Command } from "commander";
import type { ModuleContext } from "../../core/modules/module-types.js";
import { WorkflowRunStore } from "../../core/workflow/run-store.js";
import { DaemonControlClient } from "../../core/server/daemon-client.js";
import { getWorkflowDefinitions } from "./definitions-source.js";
import { formatDate, formatDuration, listRuns, statusIcon } from "./utils.js";
import type { HistoryStats } from "./workflow-history.js";
import { computeHistoryStats, loadRunsInWindow } from "./workflow-history.js";

export function registerRunListCommands(
  wfCmd: Command,
  ctx: ModuleContext,
): void {
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

      type RunRow = { id: string; workflow: string; status: string; durationMs?: number; totalCostUsd?: number; startedAt: string; trigger: { event: string }; retryOf?: string; triggeredByRunId?: string; tags?: string[] };
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
          : listRuns(store, limit * 3); // over-fetch to allow filtering
        const filtered = runs
          .filter((r) => !opts.workflow || r.workflow === opts.workflow)
          .filter((r) => !opts.status || r.status === opts.status)
          .filter((r) => !opts.tag || (r.tags ?? []).includes(opts.tag as string));
        page = filtered.slice(0, limit);
      }

      if (page.length === 0) {
        console.log("No runs found.");
        return;
      }

      const idWidth = 42;
      const wfWidth = 12;
      const stWidth = 4;
      const durWidth = 8;
      const costWidth = 8;
      const dateWidth = 18;

      console.log(
        `${"ID".padEnd(idWidth)} ${"Workflow".padEnd(wfWidth)} ${"St".padEnd(stWidth)} ${"Duration".padEnd(durWidth)} ${"Cost".padEnd(costWidth)} ${"Started".padEnd(dateWidth)} Trigger`,
      );
      console.log("-".repeat(120));

      for (const r of page) {
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
        console.log(`${id} ${wf} ${st} ${dur} ${cost} ${started} ${trigger}${tagStr}`);
      }

      const definitions = getWorkflowDefinitions(ctx);
      const budgeted = definitions.filter((d) => d.dailyBudgetUsd != null);
      if (budgeted.length > 0) {
        console.log("\nToday's budget utilization:");
        for (const def of budgeted) {
          const spend = store.getDailySpendUsd(def.name);
          const budget = def.dailyBudgetUsd as number;
          const pct = Math.min(100, (spend / budget) * 100).toFixed(1);
          const status = spend >= budget ? " [PAUSED]" : "";
          console.log(`  ${def.name}: $${spend.toFixed(3)} / $${budget.toFixed(3)} (${pct}%)${status}`);
        }
      }
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
        console.log(`No runs found in the last ${days} day${days === 1 ? "" : "s"}.`);
        return;
      }

      const wfNames = opts.workflow
        ? [opts.workflow]
        : [...new Set(filtered.map((r) => r.workflow))].sort();

      const nameWidth = Math.max(...wfNames.map((n) => n.length), 8);
      const col = (s: string, w: number) => s.padEnd(w);
      const header = `${col("Workflow", nameWidth)}  ${"Runs".padStart(5)}  ${"OK".padStart(4)}  ${"Fail".padStart(4)}  ${"Int".padStart(3)}  ${"Rate".padStart(6)}  ${"TotalCost".padStart(10)}  ${"AvgCost".padStart(8)}  ${"AvgDur".padStart(8)}  ${"P95Dur".padStart(8)}`;
      const sep = "-".repeat(header.length);
      console.log(header);
      console.log(sep);

      const allStats: HistoryStats[] = [];
      for (const name of wfNames) {
        const wfRuns = filtered.filter((r) => r.workflow === name);
        const s = computeHistoryStats(wfRuns);
        allStats.push(s);
        const avgDur = s.avgDurationMs != null ? formatDuration(Math.round(s.avgDurationMs)) : "—";
        const p95Dur = s.p95DurationMs != null ? formatDuration(s.p95DurationMs) : "—";
        console.log(
          `${col(name, nameWidth)}  ${String(s.total).padStart(5)}  ${String(s.successes).padStart(4)}  ${String(s.failures).padStart(4)}  ${String(s.interrupted).padStart(3)}  ${`${s.successRate.toFixed(1)}%`.padStart(6)}  ${`$${s.totalCostUsd.toFixed(3)}`.padStart(10)}  ${`$${s.avgCostUsd.toFixed(3)}`.padStart(8)}  ${avgDur.padStart(8)}  ${p95Dur.padStart(8)}`,
        );
      }

      if (wfNames.length > 1) {
        const totals = allStats.reduce(
          (acc, s) => ({
            total: acc.total + s.total,
            successes: acc.successes + s.successes,
            failures: acc.failures + s.failures,
            interrupted: acc.interrupted + s.interrupted,
            totalCostUsd: acc.totalCostUsd + s.totalCostUsd,
          }),
          { total: 0, successes: 0, failures: 0, interrupted: 0, totalCostUsd: 0 },
        );
        const totalRate = totals.total > 0 ? (totals.successes / totals.total) * 100 : 0;
        const totalAvgCost = totals.total > 0 ? totals.totalCostUsd / totals.total : 0;
        const allDurations = filtered
          .filter((r) => r.status !== "running" && r.durationMs != null)
          .map((r) => r.durationMs as number)
          .sort((a, b) => a - b);
        const totalAvgDur = allDurations.length > 0
          ? formatDuration(Math.round(allDurations.reduce((a, b) => a + b, 0) / allDurations.length))
          : "—";
        const totalP95Dur = allDurations.length > 0
          ? formatDuration(allDurations[Math.ceil(0.95 * allDurations.length) - 1])
          : "—";
        console.log(sep);
        console.log(
          `${col("TOTAL", nameWidth)}  ${String(totals.total).padStart(5)}  ${String(totals.successes).padStart(4)}  ${String(totals.failures).padStart(4)}  ${String(totals.interrupted).padStart(3)}  ${`${totalRate.toFixed(1)}%`.padStart(6)}  ${`$${totals.totalCostUsd.toFixed(3)}`.padStart(10)}  ${`$${totalAvgCost.toFixed(3)}`.padStart(8)}  ${totalAvgDur.padStart(8)}  ${totalP95Dur.padStart(8)}`,
        );
      }
      console.log(`\n(${days}-day window, ${filtered.filter((r) => r.status !== "running").length} completed runs)`);
    });
}
