import type { WatchlistEntry } from "#modules/autonomy/workflows/explorer/watchlist.js";
import type {
  RepoTaskFullRecord,
  RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  dedupeStrings,
  findMappedTasks,
  hasLocalNoopDecision,
  hasLocalWatchDecision,
  markerMatchesEntry,
  sourceRefsForEntry,
} from "./source-decision-coverage-matching.js";
import {
  SOURCE_DISPOSITIONS,
  type SourceCoverageStatus,
  type SourceCoverageWarning,
  type SourceDecisionCoverageRecord,
  type SourceDecisionDisposition,
  type SourceDecisionLocalMarker,
  type SourceDecisionTaskRef,
} from "./source-decision-coverage-types.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const OPEN_TASK_STATES: ReadonlySet<RepoTaskState> = new Set([
  "open",
  "open",
  "open",
  "blocked",
]);

export function buildSourceDecisionCoverageRecord(args: {
  entry: WatchlistEntry;
  taskById: ReadonlyMap<string, RepoTaskFullRecord>;
  tasks: readonly RepoTaskFullRecord[];
  localDecisionMarkers: readonly SourceDecisionLocalMarker[];
  nowMs: number;
  staleAfterDays: number;
}): SourceDecisionCoverageRecord {
  const sourceRefs = sourceRefsForEntry(args.entry);
  const taskRefs = findMappedTasks(args.entry, sourceRefs, args.tasks, args.taskById);
  const doneTasks = taskRefs.filter((task) => task.state === "done");
  const openTasks = taskRefs.filter((task) => OPEN_TASK_STATES.has(task.state));
  const localMarkers = args.localDecisionMarkers.filter((marker) =>
    markerMatchesEntry(marker, args.entry),
  );
  const selectedLocalMarker = selectLocalDecisionMarker(localMarkers);
  const localNoop = hasLocalNoopDecision(args.entry);
  const localWatch = hasLocalWatchDecision(args.entry);
  const warnings = warningsForEntry(args.entry, args.nowMs, args.staleAfterDays);
  const disposition = determineDisposition({
    localMarkers,
    localNoop,
    localWatch,
    doneTasks,
    openTasks,
    warnings,
  });
  const coverageStatuses = coverageStatusesFor({
    doneTasks,
    openTasks,
    hasLocalDecision: localMarkers.length > 0 || localNoop || localWatch,
  });

  return {
    source: args.entry.url,
    disposition,
    coverageStatuses,
    decisionSummary: decisionSummaryFor(
      args.entry,
      selectedLocalMarker,
      taskRefs,
      localNoop,
    ),
    coveredByDoneTasks: doneTasks,
    coveredByOpenTasks: openTasks,
    localDecisionRefs: dedupeStrings(localMarkers.flatMap((marker) => marker.refs)),
    remainingGap: remainingGapFor({
      localMarker: selectedLocalMarker,
      openTasks,
      warnings,
      coverageStatuses,
    }),
    warnings,
    snapshotLastSeenAt: args.entry.snapshot?.last_seen_at ?? null,
  };
}

function determineDisposition(args: {
  localMarkers: readonly SourceDecisionLocalMarker[];
  localNoop: boolean;
  localWatch: boolean;
  doneTasks: readonly SourceDecisionTaskRef[];
  openTasks: readonly SourceDecisionTaskRef[];
  warnings: readonly SourceCoverageWarning[];
}): SourceDecisionDisposition {
  const markerDisposition = strongestMarkerDisposition(args.localMarkers);
  if (markerDisposition !== null) return markerDisposition;
  if (args.openTasks.length > 0) return "partial-adopt";
  if (args.doneTasks.length > 0) return "adopt";
  if (args.localNoop) return "no-op";
  if (args.localWatch) return "watch";
  if (args.warnings.some((warning) => warning.kind === "unverified-source-snapshot")) {
    return "needs-research";
  }
  return "needs-research";
}

function strongestMarkerDisposition(
  markers: readonly SourceDecisionLocalMarker[],
): SourceDecisionDisposition | null {
  for (const disposition of SOURCE_DISPOSITIONS) {
    if (markers.some((marker) => marker.disposition === disposition)) {
      return disposition;
    }
  }
  return null;
}

function selectLocalDecisionMarker(
  markers: readonly SourceDecisionLocalMarker[],
): SourceDecisionLocalMarker | null {
  const disposition = strongestMarkerDisposition(markers);
  if (disposition === null) return null;
  return markers.find((marker) => marker.disposition === disposition) ?? null;
}

function coverageStatusesFor(args: {
  doneTasks: readonly SourceDecisionTaskRef[];
  openTasks: readonly SourceDecisionTaskRef[];
  hasLocalDecision: boolean;
}): SourceCoverageStatus[] {
  const statuses: SourceCoverageStatus[] = [];
  if (args.doneTasks.length > 0) statuses.push("covered-by-done-task");
  if (args.openTasks.length > 0) statuses.push("covered-by-open-task");
  if (args.hasLocalDecision) statuses.push("local-decision");
  if (statuses.length === 0) statuses.push("unmapped");
  return statuses;
}

function decisionSummaryFor(
  entry: WatchlistEntry,
  localMarker: SourceDecisionLocalMarker | null,
  taskRefs: readonly SourceDecisionTaskRef[],
  localNoop: boolean,
): string {
  const markerSummary = localMarker?.summary;
  if (markerSummary !== undefined) return truncate(markerSummary, 220);
  if (taskRefs.length > 0) {
    return `Mapped to local task coverage: ${taskRefs.map((task) => task.id).join(", ")}.`;
  }
  if (localNoop && entry.snapshot?.summary !== undefined) {
    return truncate(entry.snapshot.summary, 220);
  }
  if (entry.notes !== undefined) return truncate(entry.notes, 220);
  return "No local decision marker or task mapping found.";
}

function remainingGapFor(args: {
  localMarker: SourceDecisionLocalMarker | null;
  openTasks: readonly SourceDecisionTaskRef[];
  warnings: readonly SourceCoverageWarning[];
  coverageStatuses: readonly SourceCoverageStatus[];
}): string | null {
  const markerGap = args.localMarker?.remainingGap;
  if (markerGap !== undefined && markerGap !== null && markerGap.length > 0) {
    return markerGap;
  }
  if (args.openTasks.length > 0) {
    return `Open task coverage remains: ${args.openTasks.map((task) => task.id).join(", ")}.`;
  }
  if (args.coverageStatuses.includes("unmapped")) {
    return "No task id, exact source reference, or local decision marker maps this source.";
  }
  if (args.warnings.some((warning) => warning.kind === "unverified-source-snapshot")) {
    return "Source snapshot is missing or inaccessible; re-check before closing the research loop.";
  }
  return null;
}

function warningsForEntry(
  entry: WatchlistEntry,
  nowMs: number,
  staleAfterDays: number,
): SourceCoverageWarning[] {
  const warnings: SourceCoverageWarning[] = [];
  if (entry.snapshot === undefined || entry.status === "inaccessible") {
    warnings.push({
      kind: "unverified-source-snapshot",
      message:
        entry.status === "inaccessible"
          ? "source is marked inaccessible"
          : "watchlist entry has no captured snapshot",
    });
    return warnings;
  }
  const lastSeenMs = Date.parse(entry.snapshot.last_seen_at);
  if (!Number.isFinite(lastSeenMs)) {
    warnings.push({
      kind: "unverified-source-snapshot",
      message: "snapshot last_seen_at is not parseable",
    });
    return warnings;
  }
  const ageDays = Math.floor((nowMs - lastSeenMs) / MS_PER_DAY);
  if (ageDays > staleAfterDays) {
    warnings.push({
      kind: "stale-source-snapshot",
      message: `snapshot is ${ageDays} days old`,
    });
  }
  return warnings;
}

function truncate(value: string, maxLength: number): string {
  const oneLine = value.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxLength) return oneLine;
  return `${oneLine.slice(0, maxLength - 3)}...`;
}
