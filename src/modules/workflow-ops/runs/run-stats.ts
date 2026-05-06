import type { Command } from "commander";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import {
  blank,
  columns,
  line,
  plain,
  type RenderNode,
  type SemanticRole,
  stack,
} from "#modules/rendering/primitives.js";
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

export function buildStatsNode(rows: StatsRow[], days: number): RenderNode {
  return stack(
    columns(
      [
        { header: "Workflow", role: "accent", minWidth: 8 },
        { header: "Runs", align: "right", minWidth: 4 },
        { header: "Success", align: "right", minWidth: 7 },
        { header: "Failed", align: "right", minWidth: 6 },
        { header: "Avg Duration", align: "right", minWidth: 8 },
        { header: "Total Cost", align: "right", minWidth: 8 },
      ],
      rows.map((row) => {
        const avgDur =
          row.avgDurationMs != null ? formatDuration(Math.round(row.avgDurationMs)) : "—";
        return {
          cells: [
            { spans: [{ text: row.workflow, role: "accent" as SemanticRole }] },
            { spans: [{ text: String(row.runs) }] },
            { spans: [{ text: String(row.successes), role: "success" as SemanticRole }] },
            {
              spans: [
                {
                  text: String(row.failures),
                  role: (row.failures > 0 ? "error" : "muted") as SemanticRole,
                },
              ],
            },
            { spans: [{ text: avgDur }] },
            { spans: [{ text: `$${row.totalCostUsd.toFixed(3)}`, role: "muted" as SemanticRole }] },
          ],
        };
      }),
    ),
    blank(),
    line(plain(`(${days}-day window)`)),
  );
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
        // biome-ignore lint/suspicious/noConsole: structured JSON output path stays on console
        console.log(JSON.stringify(rows, null, 2));
        return;
      }

      if (rows.length === 0) {
        print(line(plain(`No runs found in the last ${days} day${days === 1 ? "" : "s"}.`)));
        return;
      }

      print(buildStatsNode(rows, days));
    });
}
