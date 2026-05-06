import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
import {
  blank,
  type ColumnsNode,
  columns,
  group,
  line,
  plain,
  type RenderNode,
  type SemanticRole,
  stack,
} from "#modules/rendering/primitives.js";
import { print } from "#modules/rendering/transport.js";
import { formatDate } from "../utils.js";

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

function runStatusRole(status: string): SemanticRole {
  switch (status) {
    case "success":
      return "success";
    case "failed":
      return "error";
    case "interrupted":
      return "warn";
    case "completed-with-warnings":
      return "warn";
    case "running":
      return "info";
    default:
      return "muted";
  }
}

export function buildSummaryTableNode(rows: WorkflowCostRow[]): ColumnsNode | null {
  if (rows.length === 0) return null;
  return columns(
    [
      { header: "Workflow", role: "accent", minWidth: 8 },
      { header: "Total", align: "right", minWidth: 8 },
      { header: "Runs", align: "right", minWidth: 4 },
      { header: "Avg/run", align: "right", minWidth: 8 },
      { header: "Max run", align: "right", minWidth: 8 },
    ],
    rows.map((row) => ({
      cells: [
        { spans: [{ text: row.workflow, role: "accent" as SemanticRole }] },
        { spans: [{ text: `$${row.totalCostUsd.toFixed(4)}`, role: "muted" as SemanticRole }] },
        { spans: [{ text: String(row.runs) }] },
        { spans: [{ text: `$${row.averageCostUsd.toFixed(4)}`, role: "muted" as SemanticRole }] },
        { spans: [{ text: `$${row.maxRunCostUsd.toFixed(4)}`, role: "muted" as SemanticRole }] },
      ],
    })),
  );
}

export function buildRunBreakdownNode(runs: RunCostEntry[]): RenderNode {
  const finished = runs.filter((r) => r.status !== "running");
  if (finished.length === 0) return line(plain("  (no completed runs)"));
  const sorted = [...finished].sort((a, b) => (b.totalCostUsd ?? 0) - (a.totalCostUsd ?? 0));
  return columns(
    [
      { header: "Run", role: "accent" },
      { header: "Cost", align: "right", minWidth: 8 },
      { header: "Started" },
      { header: "Status" },
    ],
    sorted.map((run) => {
      const cost = run.totalCostUsd != null ? `$${run.totalCostUsd.toFixed(4)}` : "—";
      return {
        cells: [
          { spans: [{ text: run.id, role: "accent" as SemanticRole }] },
          { spans: [{ text: cost, role: "muted" as SemanticRole }] },
          { spans: [{ text: formatDate(run.startedAt), role: "muted" as SemanticRole }] },
          { spans: [{ text: run.status, role: runStatusRole(run.status) }] },
        ],
      };
    }),
  );
}

export function registerCostCommand(wfCmd: Command, ctx: ModuleContext): void {
  wfCmd
    .command("cost")
    .description("Show per-workflow cost ranked by total spend")
    .option("-w, --workflow <name>", "Drill into one workflow with per-run breakdown")
    .option("--days <n>", "Lookback window in days", "7")
    .option("--json", "Output as JSON")
    .action(async (opts: { workflow?: string; days: string; json?: boolean }) => {
      const days = Math.max(1, Number.parseInt(opts.days, 10) || 7);
      const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
      const result = await ctx.client.workflow.listRuns({
        ...(opts.workflow !== undefined && { workflow: opts.workflow }),
        limit: 1000,
      });
      const runs: RunCostEntry[] = result.runs
        .filter((r) => new Date(r.startedAt).getTime() >= cutoffMs)
        .map((r) => ({
          id: r.id,
          workflow: r.workflow,
          status: r.status,
          startedAt: r.startedAt,
          ...(r.totalCostUsd !== undefined && { totalCostUsd: r.totalCostUsd }),
        }));
      const rows = computeWorkflowCostRows(runs);
      const finished = runs.filter((r) => r.status !== "running");
      const grandTotal = finished.reduce((s, r) => s + (r.totalCostUsd ?? 0), 0);

      if (opts.json) {
        // biome-ignore lint/suspicious/noConsole: structured JSON output path stays on console
        console.log(JSON.stringify(
          { days, totalCostUsd: grandTotal, runCount: finished.length, workflows: rows },
          null,
          2,
        ));
        return;
      }

      if (rows.length === 0) {
        print(line(plain(`No runs found in the last ${days} day${days === 1 ? "" : "s"}.`)));
        return;
      }

      const summary = line(
        plain(`Last ${days} day${days === 1 ? "" : "s"} — `),
        { text: `$${grandTotal.toFixed(4)}`, role: "accent" },
        plain(
          ` total across ${finished.length} run${finished.length === 1 ? "" : "s"}`,
        ),
      );
      const summaryTable = buildSummaryTableNode(rows);
      const blocks: RenderNode[] = [summary, blank()];
      if (summaryTable) blocks.push(summaryTable);
      print(stack(...blocks));

      if (opts.workflow) {
        print(
          group(
            `Per-run breakdown — ${opts.workflow}`,
            buildRunBreakdownNode(runs),
            "info",
          ),
        );
      }
    });
}
