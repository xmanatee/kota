import type { Command } from "commander";
import type { AgentUsage } from "#core/agent-harness/usage.js";
import type { ModuleContext } from "#core/modules/module-types.js";
import { WorkflowRunStore } from "#core/workflow/run-store.js";
import {
  blank,
  type ColumnsNode,
  columns,
  line,
  plain,
  type RenderNode,
  type SemanticRole,
  span,
  stack,
} from "#modules/rendering/primitives.js";
import { print, printToStderr, writeJson } from "#modules/rendering/transport.js";
import { formatDate, formatDuration, statusIcon } from "../utils.js";
import type { HistoryStats } from "./workflow-history.js";
import { computeHistoryStats, loadRunsInWindow } from "./workflow-history.js";

type RunRow = {
  id: string;
  workflow: string;
  status: string;
  durationMs?: number;
  usage?: AgentUsage;
  startedAt: string;
  trigger: { event: string };
  retryOf?: string;
  triggeredByRunId?: string;
  tags?: string[];
};

export function registerRunListCommands(wfCmd: Command, ctx: ModuleContext): void {
  wfCmd
    .command("list")
    .description("List recent workflow runs")
    .option("-n, --limit <n>", "Number of runs to show", "20")
    .option("-w, --workflow <name>", "Filter by workflow name")
    .option("-s, --status <status>", "Filter by run status (success, failed, interrupted, completed-with-warnings, running)")
    .option("-t, --tag <tag>", "Filter by tag")
    .option("--caused-by <run-id>", "Filter by upstream run ID (show runs triggered by this run)")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const validStatuses = ["success", "failed", "interrupted", "completed-with-warnings", "running"];
      if (opts.status && !validStatuses.includes(opts.status)) {
        printToStderr(line(span(`Unknown status "${opts.status}". Valid values: ${validStatuses.join(", ")}`, "error")));
        process.exit(1);
      }
      const limit = Number.parseInt(opts.limit, 10) || 20;
      const causedByRunId = opts.causedBy as string | undefined;

      const result = await ctx.client.workflow.listRuns({
        workflow: opts.workflow,
        tag: opts.tag,
        limit: limit * 3,
        causedByRunId,
      });

      const filtered = result.runs
        .filter((r) => !opts.status || r.status === opts.status)
      const page: RunRow[] = filtered.slice(0, limit).map((r) => ({
        id: r.id,
        workflow: r.workflow,
        status: r.status,
        durationMs: r.durationMs,
        usage: r.usage,
        startedAt: r.startedAt,
        trigger: { event: r.triggerEvent },
        retryOf: r.retryOf,
        triggeredByRunId: r.triggeredByRunId,
        tags: r.tags,
      }));

      if (opts.json) {
        writeJson({ runs: page }, { pretty: true });
        return;
      }

      if (page.length === 0) {
        print(line(plain("No runs found.")));
        return;
      }
      print(buildRunListNode(page));
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
      print(buildHistoryNode(wfRows, totals, days, completedCount));
    });
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

export function buildRunListNode(page: RunRow[]): ColumnsNode {
  return columns(
    [
      { header: "ID", role: "accent", maxWidth: 42 },
      { header: "Workflow", maxWidth: 18 },
      { header: "St", minWidth: 2 },
      { header: "Duration", align: "right", minWidth: 6 },
      { header: "Cost", align: "right", minWidth: 6 },
      { header: "Started" },
      { header: "Trigger", maxWidth: 60 },
    ],
    page.map((r) => {
      const dur = r.durationMs != null ? formatDuration(r.durationMs) : "…";
      const cost = r.usage?.cost.state === "complete"
        ? `$${r.usage.cost.usd.toFixed(3)}`
        : r.usage?.cost.state ?? "—";
      const triggerText = r.retryOf
        ? `retry ← ${r.retryOf}`
        : r.triggeredByRunId
          ? `${r.trigger.event} ← ${r.triggeredByRunId}`
          : r.trigger.event;
      const tagSuffix = r.tags && r.tags.length > 0 ? ` [${r.tags.join(",")}]` : "";
      return {
        cells: [
          { spans: [{ text: r.id, role: "accent" }] },
          { spans: [{ text: r.workflow }] },
          { spans: [{ text: statusIcon(r.status), role: runStatusRole(r.status) }] },
          { spans: [{ text: dur }] },
          { spans: [{ text: cost, role: "muted" }] },
          { spans: [{ text: formatDate(r.startedAt), role: "muted" }] },
          { spans: [{ text: `${triggerText}${tagSuffix}` }] },
        ],
      };
    }),
  );
}

export type HistoryTotals = {
  total: number;
  successes: number;
  failures: number;
  interrupted: number;
  totalCostUsd: number | null;
  measuredCostRuns: number;
  unavailableCostRuns: number;
  unknownCostRuns: number;
  successRate: number;
  avgCostUsd: number | null;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
};

export function computeHistoryTotals(
  stats: HistoryStats[],
  filteredRuns: Array<{ status: string; durationMs?: number }>,
): HistoryTotals {
  const acc = stats.reduce<Pick<
    HistoryTotals,
    | "total"
    | "successes"
    | "failures"
    | "interrupted"
    | "totalCostUsd"
    | "measuredCostRuns"
    | "unavailableCostRuns"
    | "unknownCostRuns"
  >>(
    (a, s) => ({
      total: a.total + s.total,
      successes: a.successes + s.successes,
      failures: a.failures + s.failures,
      interrupted: a.interrupted + s.interrupted,
      totalCostUsd: a.totalCostUsd === null
        ? s.totalCostUsd
        : s.totalCostUsd === null
          ? a.totalCostUsd
          : a.totalCostUsd + s.totalCostUsd,
      measuredCostRuns: a.measuredCostRuns + s.measuredCostRuns,
      unavailableCostRuns: a.unavailableCostRuns + s.unavailableCostRuns,
      unknownCostRuns: a.unknownCostRuns + s.unknownCostRuns,
    }),
    {
      total: 0,
      successes: 0,
      failures: 0,
      interrupted: 0,
      totalCostUsd: null,
      measuredCostRuns: 0,
      unavailableCostRuns: 0,
      unknownCostRuns: 0,
    },
  );
  const successRate = acc.total > 0 ? (acc.successes / acc.total) * 100 : 0;
  const avgCostUsd = acc.totalCostUsd === null || acc.measuredCostRuns === 0
    ? null
    : acc.totalCostUsd / acc.measuredCostRuns;
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

export function buildHistoryNode(
  wfRows: Array<{ name: string; stats: HistoryStats }>,
  totals: HistoryTotals | null,
  days: number,
  completedCount: number,
): RenderNode {
  const headerSpecs = [
    { header: "Workflow", role: "accent" as const, minWidth: 8 },
    { header: "Runs", align: "right" as const, minWidth: 4 },
    { header: "OK", align: "right" as const, minWidth: 3 },
    { header: "Fail", align: "right" as const, minWidth: 4 },
    { header: "Int", align: "right" as const, minWidth: 3 },
    { header: "Rate", align: "right" as const, minWidth: 5 },
    { header: "TotalCost", align: "right" as const, minWidth: 8 },
    { header: "AvgCost", align: "right" as const, minWidth: 7 },
    { header: "AvgDur", align: "right" as const, minWidth: 6 },
    { header: "P95Dur", align: "right" as const, minWidth: 6 },
  ];

  const dataRows = wfRows.map(({ name, stats: s }) => {
    const avgDur = s.avgDurationMs != null ? formatDuration(Math.round(s.avgDurationMs)) : "—";
    const p95Dur = s.p95DurationMs != null ? formatDuration(s.p95DurationMs) : "—";
    return {
      cells: [
        { spans: [{ text: name, role: "accent" as SemanticRole }] },
        { spans: [{ text: String(s.total) }] },
        { spans: [{ text: String(s.successes), role: "success" as SemanticRole }] },
        {
          spans: [
            { text: String(s.failures), role: (s.failures > 0 ? "error" : "muted") as SemanticRole },
          ],
        },
        { spans: [{ text: String(s.interrupted), role: "warn" as SemanticRole }] },
        { spans: [{ text: `${s.successRate.toFixed(1)}%` }] },
        { spans: [{ text: s.totalCostUsd === null ? "—" : `$${s.totalCostUsd.toFixed(3)}`, role: "muted" as SemanticRole }] },
        { spans: [{ text: s.avgCostUsd === null ? "—" : `$${s.avgCostUsd.toFixed(3)}`, role: "muted" as SemanticRole }] },
        { spans: [{ text: avgDur }] },
        { spans: [{ text: p95Dur }] },
      ],
    };
  });

  const tableRows = [...dataRows];
  if (totals) {
    const avgDur = totals.avgDurationMs != null ? formatDuration(Math.round(totals.avgDurationMs)) : "—";
    const p95Dur = totals.p95DurationMs != null ? formatDuration(totals.p95DurationMs) : "—";
    tableRows.push({
      cells: [
        { spans: [{ text: "TOTAL", role: "accent" as SemanticRole }] },
        { spans: [{ text: String(totals.total) }] },
        { spans: [{ text: String(totals.successes), role: "success" as SemanticRole }] },
        {
          spans: [
            {
              text: String(totals.failures),
              role: (totals.failures > 0 ? "error" : "muted") as SemanticRole,
            },
          ],
        },
        { spans: [{ text: String(totals.interrupted), role: "warn" as SemanticRole }] },
        { spans: [{ text: `${totals.successRate.toFixed(1)}%` }] },
        { spans: [{ text: totals.totalCostUsd === null ? "—" : `$${totals.totalCostUsd.toFixed(3)}`, role: "muted" as SemanticRole }] },
        { spans: [{ text: totals.avgCostUsd === null ? "—" : `$${totals.avgCostUsd.toFixed(3)}`, role: "muted" as SemanticRole }] },
        { spans: [{ text: avgDur }] },
        { spans: [{ text: p95Dur }] },
      ],
    });
  }

  return stack(
    columns(headerSpecs, tableRows),
    blank(),
    line(plain(`(${days}-day window, ${completedCount} completed runs)`)),
  );
}
