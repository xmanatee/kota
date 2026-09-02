/**
 * `kota report` — operator-facing autonomy balance and quality report.
 *
 * Aggregates from `data/tasks/`, run metadata under the runs directory, and
 * runtime-owned writer integration evidence. The output is intentionally read-only and
 * routes through the rendering layer; per the no-cost-bias-in-autonomy
 * contract it is not exposed to autonomy agents.
 */

import { join } from "node:path";
import { Command } from "commander";
import { resolveScopeRoot } from "#core/config/scope-root.js";
import { print, writeJson } from "#modules/rendering/transport.js";
import {
  aggregateAutonomyReport,
  DEFAULT_REPORT_WINDOW_DAYS,
} from "./aggregate.js";
import {
  type AutonomyReportDataWithControlCoverage,
  attachControlCoverageToReport,
  renderAutonomyReportWithControlCoverage,
} from "./control-coverage-report-window.js";
import { renderAutonomyReport } from "./render.js";
import { renderSourceDecisionCoverageReport } from "./render-source-decision-coverage.js";
import { buildSourceDecisionCoverageReport } from "./source-decision-coverage.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ReportCommandOptions = {
  days?: string;
  json?: boolean;
};

export type SourceCoverageCommandOptions = {
  all?: boolean;
  json?: boolean;
  limit?: string;
  source?: string[];
  staleDays?: string;
};

type CommanderOptions<TOptions> = TOptions & {
  opts?: () => TOptions;
  parent?: {
    opts?: () => ReportCommandOptions;
  };
};

export function buildReportCommand(): Command {
  const command = new Command("report")
    .description(
      "Print the operator autonomy balance/quality report for the current scope " +
        `(default window ${DEFAULT_REPORT_WINDOW_DAYS} days)`,
    )
    .option(
      "--days <n>",
      "Lookback window in days",
      String(DEFAULT_REPORT_WINDOW_DAYS),
    )
    .option(
      "--json",
      "Emit the structured report payload as JSON instead of the rendered text",
    )
    .action((opts: ReportCommandOptions) => {
      const days = parseDaysOption(opts.days);
      const workspaceRoot = resolveScopeRoot();
      const stateDir = join(workspaceRoot, ".kota");
      const runsDir = join(stateDir, "runs");
      const windowEndMs = Date.now();
      const windowStartMs = windowEndMs - days * MS_PER_DAY;
      const baseData = aggregateAutonomyReport({
        workspaceRoot,
        stateDir,
        runsDir,
        windowEndMs,
        windowDays: days,
      });
      const data = attachControlCoverageToReport(baseData, {
        runsDir,
        stateDir,
        scopeRoot: workspaceRoot,
        windowStartMs,
        windowEndMs,
      });
      emitReport(data, opts.json === true);
    });
  command.addCommand(buildSourceCoverageCommand());
  return command;
}

function buildSourceCoverageCommand(): Command {
  return new Command("sources")
    .description(
      "Print watchlist source-to-local-decision coverage without fetching the web",
    )
    .option("--all", "Include every watchlist source instead of the recent limit")
    .option("--limit <n>", "Maximum recent watchlist sources to include", "25")
    .option(
      "--source <url>",
      "Only include a source URL or canonicalized source URL (repeatable)",
      collectSourceOption,
      [],
    )
    .option("--stale-days <n>", "Snapshot age that counts as stale", "45")
    .option("--json", "Emit the structured source coverage payload as JSON")
    .action((
      rawOpts: CommanderOptions<SourceCoverageCommandOptions>,
      command: CommanderOptions<SourceCoverageCommandOptions>,
    ) => {
      const opts = resolveCommanderOptions(rawOpts);
      const workspaceRoot = resolveScopeRoot();
      const report = buildSourceDecisionCoverageReport({
        workspaceRoot,
        maxEntries: opts.all === true ? 0 : parsePositiveInteger(opts.limit, "--limit"),
        sourceUrls: opts.source,
        staleAfterDays: parsePositiveInteger(opts.staleDays, "--stale-days"),
      });
      emitSourceCoverageReport(
        report,
        opts.json === true || parentJson(command),
      );
    });
}

export function emitReport(
  data: AutonomyReportDataWithControlCoverage,
  asJson: boolean,
): void {
  if (asJson) {
    writeJson(data, { pretty: true });
    return;
  }
  print(renderAutonomyReportWithControlCoverage(data, renderAutonomyReport(data)));
}

export function emitSourceCoverageReport(
  data: ReturnType<typeof buildSourceDecisionCoverageReport>,
  asJson: boolean,
): void {
  if (asJson) {
    writeJson(data, { pretty: true });
    return;
  }
  print(renderSourceDecisionCoverageReport(data));
}

function parseDaysOption(raw: string | undefined): number {
  return parsePositiveInteger(raw ?? String(DEFAULT_REPORT_WINDOW_DAYS), "--days");
}

function parsePositiveInteger(raw: string | undefined, optionName: string): number {
  if (raw === undefined) return DEFAULT_REPORT_WINDOW_DAYS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `${optionName} must be a positive integer, got "${raw}"`,
    );
  }
  return parsed;
}

function collectSourceOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function resolveCommanderOptions<TOptions>(opts: CommanderOptions<TOptions>): TOptions {
  return typeof opts.opts === "function" ? opts.opts() : opts;
}

function parentJson(
  opts: CommanderOptions<SourceCoverageCommandOptions>,
): boolean {
  return opts.parent?.opts?.().json === true;
}
