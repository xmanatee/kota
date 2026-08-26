import type { RepoTaskState } from "#modules/repo-tasks/repo-tasks-domain.js";

export const DEFAULT_SOURCE_REPORT_LIMIT = 25;
export const DEFAULT_STALE_AFTER_DAYS = 45;

export const SOURCE_DISPOSITIONS = [
  "adopt",
  "partial-adopt",
  "reject",
  "watch",
  "no-op",
  "needs-research",
] as const;

export type SourceDecisionDisposition = (typeof SOURCE_DISPOSITIONS)[number];

export const SOURCE_COVERAGE_STATUSES = [
  "covered-by-done-task",
  "covered-by-open-task",
  "local-decision",
  "unmapped",
] as const;

export type SourceCoverageStatus = (typeof SOURCE_COVERAGE_STATUSES)[number];

export type SourceCoverageWarningKind =
  | "stale-source-snapshot"
  | "unverified-source-snapshot";

export type SourceDecisionTaskRef = {
  id: string;
  title: string;
  state: RepoTaskState;
};

export type SourceDecisionLocalMarker = {
  sourceRefs: readonly string[];
  disposition: SourceDecisionDisposition;
  summary: string;
  refs: readonly string[];
  remainingGap?: string | null;
};

export type SourceCoverageWarning = {
  kind: SourceCoverageWarningKind;
  message: string;
};

export type SourceDecisionCoverageRecord = {
  source: string;
  disposition: SourceDecisionDisposition;
  coverageStatuses: SourceCoverageStatus[];
  decisionSummary: string;
  coveredByDoneTasks: SourceDecisionTaskRef[];
  coveredByOpenTasks: SourceDecisionTaskRef[];
  localDecisionRefs: string[];
  remainingGap: string | null;
  warnings: SourceCoverageWarning[];
  snapshotLastSeenAt: string | null;
};

export type SourceCoverageCount<TKey extends string> = {
  count: number;
} & {
  [key in TKey]: string;
};

export type SourceDecisionCoverageReport = {
  totalSources: number;
  selectedSources: number;
  staleAfterDays: number;
  byDisposition: SourceCoverageCount<"disposition">[];
  byCoverageStatus: SourceCoverageCount<"coverageStatus">[];
  staleWarningCount: number;
  unverifiedWarningCount: number;
  records: SourceDecisionCoverageRecord[];
};

export type SourceDecisionCoverageInput = {
  workspaceRoot: string;
  nowMs?: number;
  maxEntries?: number;
  sourceUrls?: readonly string[];
  staleAfterDays?: number;
  localDecisionMarkers?: readonly SourceDecisionLocalMarker[];
};
