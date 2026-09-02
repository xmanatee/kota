import type { Command } from "commander";
import type { ModuleContext } from "#core/modules/module-types.js";
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
import { print, writeJson } from "#modules/rendering/transport.js";
import { formatDuration } from "../utils.js";
import {
  computeHistoryStats,
  loadRunsInWindow,
  requireWorkflowRunDurableAuthority,
  type WorkflowRunDurableAuthority,
} from "./workflow-history.js";

type StatsRow = {
  workflow: string;
  runs: number;
  successes: number;
  failures: number;
  avgDurationMs: number | null;
  totalCostUsd: number | null;
};

export function computeStatsRows(
  runsDir: string,
  cutoffMs: number,
  options: {
    authority: WorkflowRunDurableAuthority;
    untilMs?: number;
    workflow?: string;
  },
): StatsRow[] {
  const untilMs = options.untilMs ?? Number.POSITIVE_INFINITY;
  const allRuns = loadRunsInWindow(
    runsDir,
    cutoffMs,
    options.authority,
    untilMs,
  );
  const filtered = options.workflow
    ? allRuns.filter((r) => r.workflow === options.workflow)
    : allRuns;
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

export function buildStatsNode(rows: StatsRow[], windowLabel: string | number): RenderNode {
  const label = typeof windowLabel === "number" ? `${windowLabel}-day window` : windowLabel;
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
            { spans: [{ text: row.totalCostUsd === null ? "—" : `$${row.totalCostUsd.toFixed(3)}`, role: "muted" as SemanticRole }] },
          ],
        };
      }),
    ),
    blank(),
    line(plain(`(${label})`)),
  );
}

function parseDateMs(value: string | undefined, label: string): number | null {
  if (value === undefined) return null;
  const parsed = /^\d+$/.test(value) ? Number(value) : new Date(value).getTime();
  if (!Number.isFinite(parsed)) {
    throw new Error(`--${label} must be an ISO date or timestamp, got "${value}"`);
  }
  return parsed;
}

export function registerStatsCommand(wfCmd: Command, ctx: ModuleContext): void {
  wfCmd
    .command("stats")
    .description("Show aggregate workflow health: success rate, duration, and cost")
    .option("-w, --workflow <name>", "Filter by workflow name")
    .option("--days <n>", "Lookback window in days", "7")
    .option("--since <date>", "Start of the stats window (ISO date or timestamp)")
    .option("--until <date>", "End of the stats window (ISO date or timestamp)")
    .option("--json", "Output as JSON")
    .action(async (opts: { workflow?: string; days: string; since?: string; until?: string; json?: boolean }) => {
      let sinceMs: number | null;
      let untilMs: number | null;
      try {
        sinceMs = parseDateMs(opts.since, "since");
        untilMs = parseDateMs(opts.until, "until");
      } catch (error) {
        print(line(plain(error instanceof Error ? error.message : String(error))));
        process.exit(1);
      }
      const days = Math.max(1, Number.parseInt(opts.days, 10) || 7);
      const cutoffMs = sinceMs ?? Date.now() - days * 24 * 60 * 60 * 1000;
      const upperMs = untilMs ?? Number.POSITIVE_INFINITY;
      if (upperMs < cutoffMs) {
        print(line(plain("--until must be greater than or equal to --since")));
        process.exit(1);
      }
      const windowLabel = sinceMs !== null || untilMs !== null
        ? `${new Date(cutoffMs).toISOString()}..${Number.isFinite(upperMs) ? new Date(upperMs).toISOString() : "now"}`
        : `${days}-day window`;
      const store = new WorkflowRunStore(ctx.cwd);
      const status = await ctx.client.workflow.status();
      const rows = computeStatsRows(store.runsDir, cutoffMs, {
        authority: requireWorkflowRunDurableAuthority(
          status.authorityCriticalRunIds,
          status.operationallyActiveRunIds,
          status.terminalRunIds,
        ),
        untilMs: upperMs,
        workflow: opts.workflow,
      });

      if (opts.json) {
        writeJson({
          window: {
            since: new Date(cutoffMs).toISOString(),
            until: Number.isFinite(upperMs) ? new Date(upperMs).toISOString() : null,
          },
          rows,
        }, { pretty: true });
        return;
      }

      if (rows.length === 0) {
        print(line(plain(`No runs found in ${windowLabel}.`)));
        return;
      }

      print(buildStatsNode(rows, windowLabel));
    });
}
