import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type {
  RepoTaskFullRecord,
  RepoTaskState,
} from "#modules/repo-tasks/repo-tasks-domain.js";

export type CodeHealthWarningFamily = "source-size";

export type CodeHealthDriftOutcome = "warning" | "cleanup-exception";

export type CodeHealthCleanupCoverage =
  | {
      kind: "open-cleanup-task";
      taskId: string;
      taskTitle: string;
      taskState: RepoTaskState;
      files: string[];
    }
  | {
      kind: "cleanup-exception";
      runId: string;
      taskId: string | null;
      taskPath: string;
      files: string[];
    };

export type CodeHealthDriftRecord = {
  runId: string;
  taskId: string | null;
  commitRef: string | null;
  changedSourceFiles: string[];
  warningFamily: CodeHealthWarningFamily;
  outcome: CodeHealthDriftOutcome;
  warningCount: number;
  files: string[];
  cleanupCoverage: CodeHealthCleanupCoverage[];
};

export type CodeHealthCountRow = {
  key: string;
  count: number;
};

export type CodeHealthRepeatedSurface = {
  file: string;
  warningFamily: CodeHealthWarningFamily;
  currentWarnings: number;
  priorWarnings: number;
  totalWarnings: number;
  latestRunId: string;
  cleanupCoverage: CodeHealthCleanupCoverage[];
};

export type CodeHealthTrendBucket = {
  bucket: "current" | "prior";
  totalBuilderRuns: number;
  runsWithWarnings: number;
  warningRecords: number;
  cleanupExceptionRuns: number;
  unsupportedArtifacts: number;
};

export type CodeHealthDriftReport = {
  totalBuilderRuns: number;
  runsWithWarnings: number;
  unsupportedArtifacts: number;
  byWarningFamily: CodeHealthCountRow[];
  bySurfaceArea: CodeHealthCountRow[];
  repeatedSurfaces: CodeHealthRepeatedSurface[];
  trendBuckets: CodeHealthTrendBucket[];
  records: CodeHealthDriftRecord[];
};

export type BuildCodeHealthDriftReportInput = {
  tasks: readonly RepoTaskFullRecord[];
  runs: readonly WorkflowRunMetadata[];
  runsDir: string;
  windowStartMs: number;
  windowEndMs: number;
};
