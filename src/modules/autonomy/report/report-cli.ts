/**
 * `kota report` — operator-facing autonomy balance and quality report.
 *
 * Aggregates from `data/tasks/`, run metadata under the runs directory, and
 * `run-summary.json` artifacts. The output is intentionally read-only and
 * routes through the rendering layer; per the no-cost-bias-in-autonomy
 * contract it is not exposed to autonomy agents.
 */

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { Command } from "commander";
import { resolveProjectDir } from "#core/config/project-dir.js";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
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
      "Print the operator autonomy balance/quality report for the current project " +
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
      const projectDir = resolveProjectDir();
      const runsDir = join(projectDir, ".kota", "runs");
      const windowEndMs = Date.now();
      const windowStartMs = windowEndMs - days * MS_PER_DAY;
      const baseData = aggregateAutonomyReport({
        projectDir,
        runsDir,
        windowEndMs,
        windowDays: days,
        addedFilesBySha: collectAddedFilesBySha(
          projectDir,
          windowStartMs,
        ),
      });
      const data = attachControlCoverageToReport(baseData, {
        runsDir,
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
      const projectDir = resolveProjectDir();
      const report = buildSourceDecisionCoverageReport({
        projectDir,
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

/**
 * Build a SHA → repo-relative-path map for files added during the report
 * window. Used by the aggregator to attribute explorer task additions when an
 * older explorer commit step's output recorded the SHA but not the files.
 *
 * Single git invocation over the window; one parse pass; tolerant of git
 * being unavailable (returns an empty map so the report still renders).
 */
export function collectAddedFilesBySha(
  projectDir: string,
  sinceMs: number,
): Map<string, string[]> {
  const since = new Date(sinceMs).toISOString();
  const result = spawnSync(
    "git",
    [
      "log",
      `--since=${since}`,
      "--name-status",
      "--diff-filter=A",
      "--pretty=format:COMMIT:%H",
    ],
    {
      cwd: projectDir,
      encoding: "utf-8",
      env: withProtectedGitBareRepositoryEnv(),
    },
  );
  if (result.status !== 0 || typeof result.stdout !== "string") {
    return new Map();
  }
  const map = new Map<string, string[]>();
  let currentSha: string | null = null;
  for (const rawLine of result.stdout.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith("COMMIT:")) {
      currentSha = line.slice("COMMIT:".length);
      continue;
    }
    if (!currentSha) continue;
    const tabIdx = line.indexOf("\t");
    if (tabIdx < 0) continue;
    const status = line.slice(0, tabIdx).trim();
    const path = line.slice(tabIdx + 1).trim();
    if (status !== "A" || path.length === 0) continue;
    const existing = map.get(currentSha);
    if (existing) {
      existing.push(path);
    } else {
      map.set(currentSha, [path]);
    }
  }
  return map;
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
