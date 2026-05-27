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
import { print } from "#modules/rendering/transport.js";
import {
  type AutonomyReportData,
  aggregateAutonomyReport,
  DEFAULT_REPORT_WINDOW_DAYS,
} from "./aggregate.js";
import { renderAutonomyReport } from "./render.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ReportCommandOptions = {
  days?: string;
  json?: boolean;
};

export function buildReportCommand(): Command {
  return new Command("report")
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
      "Emit the structured AutonomyReportData payload as JSON instead of the rendered text",
    )
    .action((opts: ReportCommandOptions) => {
      const days = parseDaysOption(opts.days);
      const projectDir = resolveProjectDir();
      const windowEndMs = Date.now();
      const data = aggregateAutonomyReport({
        projectDir,
        runsDir: join(projectDir, ".kota", "runs"),
        windowEndMs,
        windowDays: days,
        addedFilesBySha: collectAddedFilesBySha(
          projectDir,
          windowEndMs - days * MS_PER_DAY,
        ),
      });
      emitReport(data, opts.json === true);
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

export function emitReport(data: AutonomyReportData, asJson: boolean): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }
  print(renderAutonomyReport(data));
}

function parseDaysOption(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_REPORT_WINDOW_DAYS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `--days must be a positive integer, got "${raw}"`,
    );
  }
  return parsed;
}
