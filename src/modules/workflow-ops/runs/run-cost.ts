import type { Command } from "commander";
import type { AgentUsage } from "#core/agent-harness/usage.js";
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
import { print, writeJson } from "#modules/rendering/transport.js";
import { formatDate } from "../utils.js";

type RunCostEntry = {
  id: string;
  workflow: string;
  status: string;
  startedAt: string;
  usage?: AgentUsage;
};

export type WorkflowCostRow = {
  workflow: string;
  runs: number;
  measuredRuns: number;
  unavailableRuns: number;
  unknownRuns: number;
  measuredCostUsd: number | null;
  averageMeasuredCostUsd: number | null;
  maxMeasuredRunCostUsd: number | null;
};

export function computeWorkflowCostRows(runs: RunCostEntry[]): WorkflowCostRow[] {
  const byWf = new Map<string, {
    runs: number;
    measuredRuns: number;
    unavailableRuns: number;
    unknownRuns: number;
    totalCostUsd: number;
    maxRunCostUsd: number;
  }>();
  for (const run of runs) {
    if (run.status === "running") continue;
    const existing = byWf.get(run.workflow) ?? {
      runs: 0,
      measuredRuns: 0,
      unavailableRuns: 0,
      unknownRuns: 0,
      totalCostUsd: 0,
      maxRunCostUsd: 0,
    };
    existing.runs += 1;
    if (run.usage?.cost.state === "complete") {
      existing.measuredRuns += 1;
      existing.totalCostUsd += run.usage.cost.usd;
      if (run.usage.cost.usd > existing.maxRunCostUsd) {
        existing.maxRunCostUsd = run.usage.cost.usd;
      }
    } else if (run.usage?.cost.state === "unavailable") {
      existing.unavailableRuns += 1;
    } else {
      existing.unknownRuns += 1;
    }
    byWf.set(run.workflow, existing);
  }
  return [...byWf.entries()]
    .map(([workflow, agg]) => ({
      workflow,
      runs: agg.runs,
      measuredRuns: agg.measuredRuns,
      unavailableRuns: agg.unavailableRuns,
      unknownRuns: agg.unknownRuns,
      measuredCostUsd: agg.measuredRuns > 0 ? agg.totalCostUsd : null,
      averageMeasuredCostUsd:
        agg.measuredRuns > 0 ? agg.totalCostUsd / agg.measuredRuns : null,
      maxMeasuredRunCostUsd: agg.measuredRuns > 0 ? agg.maxRunCostUsd : null,
    }))
    .sort((a, b) => (b.measuredCostUsd ?? -1) - (a.measuredCostUsd ?? -1));
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
      { header: "Measured", align: "right", minWidth: 8 },
      { header: "Runs", align: "right", minWidth: 4 },
      { header: "Measured", align: "right", minWidth: 8 },
      { header: "Unavailable", align: "right", minWidth: 11 },
      { header: "Unknown", align: "right", minWidth: 7 },
      { header: "Avg/measured", align: "right", minWidth: 12 },
      { header: "Max run", align: "right", minWidth: 8 },
    ],
    rows.map((row) => ({
      cells: [
        { spans: [{ text: row.workflow, role: "accent" as SemanticRole }] },
        { spans: [{ text: formatCost(row.measuredCostUsd), role: "muted" as SemanticRole }] },
        { spans: [{ text: String(row.runs) }] },
        { spans: [{ text: String(row.measuredRuns) }] },
        { spans: [{ text: String(row.unavailableRuns) }] },
        { spans: [{ text: String(row.unknownRuns) }] },
        { spans: [{ text: formatCost(row.averageMeasuredCostUsd), role: "muted" as SemanticRole }] },
        { spans: [{ text: formatCost(row.maxMeasuredRunCostUsd), role: "muted" as SemanticRole }] },
      ],
    })),
  );
}

function formatCost(costUsd: number | null): string {
  return costUsd === null ? "unknown" : `$${costUsd.toFixed(4)}`;
}

export function buildRunBreakdownNode(runs: RunCostEntry[]): RenderNode {
  const finished = runs.filter((r) => r.status !== "running");
  if (finished.length === 0) return line(plain("  (no completed runs)"));
  const sorted = [...finished].sort((a, b) =>
    (b.usage?.cost.state === "complete" ? b.usage.cost.usd : -1) -
    (a.usage?.cost.state === "complete" ? a.usage.cost.usd : -1)
  );
  return columns(
    [
      { header: "Run", role: "accent" },
      { header: "Cost", align: "right", minWidth: 8 },
      { header: "Started" },
      { header: "Status" },
    ],
    sorted.map((run) => {
      const cost = run.usage?.cost.state === "complete"
        ? `$${run.usage.cost.usd.toFixed(4)}`
        : run.usage?.cost.state ?? "unknown";
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
          ...(r.usage !== undefined && { usage: r.usage }),
        }));
      const rows = computeWorkflowCostRows(runs);
      const finished = runs.filter((r) => r.status !== "running");
      const measured = finished.flatMap((run) =>
        run.usage?.cost.state === "complete" ? [run.usage.cost.usd] : []
      );
      const measuredTotal = measured.length > 0
        ? measured.reduce((sum, cost) => sum + cost, 0)
        : null;

      if (opts.json) {
        writeJson(
          { days, measuredCostUsd: measuredTotal, measuredRuns: measured.length, runCount: finished.length, workflows: rows },
          { pretty: true },
        );
        return;
      }

      if (rows.length === 0) {
        print(line(plain(`No runs found in the last ${days} day${days === 1 ? "" : "s"}.`)));
        return;
      }

      const summary = line(
        plain(`Last ${days} day${days === 1 ? "" : "s"} — `),
        { text: measuredTotal === null ? "cost unknown" : `$${measuredTotal.toFixed(4)}`, role: "accent" },
        plain(
          ` measured across ${measured.length}/${finished.length} run${finished.length === 1 ? "" : "s"}; unavailable ${finished.filter((run) => run.usage?.cost.state === "unavailable").length}; unknown ${finished.filter((run) => run.usage?.cost.state !== "complete" && run.usage?.cost.state !== "unavailable").length}`,
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
