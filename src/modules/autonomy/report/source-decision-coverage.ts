import type { WatchlistEntry } from "#modules/autonomy/workflows/explorer/watchlist.js";
import { readWatchlist } from "#modules/autonomy/workflows/explorer/watchlist.js";
import { listFullRepoTasks } from "#modules/repo-tasks/repo-tasks-domain.js";
import { defaultLocalDecisionMarkers } from "./source-decision-coverage-matching.js";
import { buildSourceDecisionCoverageRecord } from "./source-decision-coverage-record.js";
import {
  DEFAULT_SOURCE_REPORT_LIMIT,
  DEFAULT_STALE_AFTER_DAYS,
  SOURCE_COVERAGE_STATUSES,
  SOURCE_DISPOSITIONS,
  type SourceCoverageCount,
  type SourceCoverageWarningKind,
  type SourceDecisionCoverageInput,
  type SourceDecisionCoverageRecord,
  type SourceDecisionCoverageReport,
} from "./source-decision-coverage-types.js";

export {
  DEFAULT_SOURCE_REPORT_LIMIT,
  DEFAULT_STALE_AFTER_DAYS,
  SOURCE_COVERAGE_STATUSES,
  SOURCE_DISPOSITIONS,
  type SourceCoverageCount,
  type SourceCoverageStatus,
  type SourceCoverageWarning,
  type SourceCoverageWarningKind,
  type SourceDecisionCoverageInput,
  type SourceDecisionCoverageRecord,
  type SourceDecisionCoverageReport,
  type SourceDecisionDisposition,
  type SourceDecisionLocalMarker,
  type SourceDecisionTaskRef,
} from "./source-decision-coverage-types.js";

export function buildSourceDecisionCoverageReport(
  input: SourceDecisionCoverageInput,
): SourceDecisionCoverageReport {
  const nowMs = input.nowMs ?? Date.now();
  const staleAfterDays = input.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS;
  const watchlist = readWatchlist(input.projectDir);
  const selectedEntries = selectWatchlistEntries(watchlist.entries, input);
  const tasks = listFullRepoTasks(input.projectDir);
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const localDecisionMarkers =
    input.localDecisionMarkers ?? defaultLocalDecisionMarkers();

  const records = selectedEntries.map((entry) =>
    buildSourceDecisionCoverageRecord({
      entry,
      taskById,
      tasks,
      localDecisionMarkers,
      nowMs,
      staleAfterDays,
    }),
  );

  return {
    totalSources: watchlist.entries.length,
    selectedSources: records.length,
    staleAfterDays,
    byDisposition: countDispositions(records),
    byCoverageStatus: countCoverageStatuses(records),
    staleWarningCount: countWarnings(records, "stale-source-snapshot"),
    unverifiedWarningCount: countWarnings(records, "unverified-source-snapshot"),
    records,
  };
}

function selectWatchlistEntries(
  entries: readonly WatchlistEntry[],
  input: SourceDecisionCoverageInput,
): WatchlistEntry[] {
  const wantedSources = new Set(input.sourceUrls ?? []);
  const sorted = [...entries].sort((a, b) => sourceSortTime(b) - sourceSortTime(a));
  const filtered =
    wantedSources.size === 0
      ? sorted
      : sorted.filter(
          (entry) =>
            wantedSources.has(entry.url) ||
            (entry.canonicalizedFrom ?? []).some((url) => wantedSources.has(url)),
        );
  const maxEntries = input.maxEntries ?? DEFAULT_SOURCE_REPORT_LIMIT;
  return maxEntries > 0 ? filtered.slice(0, maxEntries) : filtered;
}

function sourceSortTime(entry: WatchlistEntry): number {
  const snapshotMs =
    entry.snapshot !== undefined ? Date.parse(entry.snapshot.last_seen_at) : Number.NaN;
  if (Number.isFinite(snapshotMs)) return snapshotMs;
  const addedMs = Date.parse(entry.added);
  return Number.isFinite(addedMs) ? addedMs : 0;
}

function countDispositions(
  records: readonly SourceDecisionCoverageRecord[],
): SourceCoverageCount<"disposition">[] {
  return SOURCE_DISPOSITIONS.map((disposition) => ({
    disposition,
    count: records.filter((record) => record.disposition === disposition).length,
  }));
}

function countCoverageStatuses(
  records: readonly SourceDecisionCoverageRecord[],
): SourceCoverageCount<"coverageStatus">[] {
  return SOURCE_COVERAGE_STATUSES.map((coverageStatus) => ({
    coverageStatus,
    count: records.filter((record) =>
      record.coverageStatuses.includes(coverageStatus),
    ).length,
  }));
}

function countWarnings(
  records: readonly SourceDecisionCoverageRecord[],
  kind: SourceCoverageWarningKind,
): number {
  return records.filter((record) =>
    record.warnings.some((warning) => warning.kind === kind),
  ).length;
}
