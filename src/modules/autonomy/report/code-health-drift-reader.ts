import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import type { WorkflowRunSummary } from "#modules/autonomy/run-summary.js";
import {
  isSourceSizeCheckPath,
  SOURCE_FILE_SIZE_WARNING_TYPE,
  type SourceFileSizeWarning,
} from "#modules/autonomy/source-size-check.js";
import type { SourceFileSizeReview } from "#modules/autonomy/source-size-escalation.js";
import type { RepoTaskFullRecord } from "#modules/repo-tasks/repo-tasks-domain.js";
import { findOpenCleanupCoverage } from "./code-health-drift-coverage.js";
import type { CodeHealthDriftRecord } from "./code-health-drift-types.js";

const SOURCE_SIZE_REVIEW_ARTIFACT = "source-file-size-review.json";

type BuilderSummaryWithSourceSize = WorkflowRunSummary & {
  sourceFileSize?: SourceFileSizeReview;
  warnings?: SourceFileSizeWarning[];
};

type ParsedSourceSizeReview = {
  outcome?: string;
  warnings?: Array<Partial<SourceFileSizeWarning>>;
  exception?: {
    kind?: string;
    taskPath?: string;
    files?: string[];
    reducingFiles?: string[];
  };
  message?: string;
};

export type CodeHealthRunReadResult =
  | { kind: "unsupported" }
  | { kind: "clean" }
  | { kind: "record"; record: CodeHealthDriftRecord };

export function isBuilderTerminalRun(run: WorkflowRunMetadata): boolean {
  return (
    run.workflow === "builder" &&
    (run.status === "success" || run.status === "completed-with-warnings")
  );
}

export function readCodeHealthRunRecord(
  runsDir: string,
  run: WorkflowRunMetadata,
  openTasks: readonly RepoTaskFullRecord[],
): CodeHealthRunReadResult {
  const runDir = join(runsDir, run.id);
  const summary = readSummary(runDir);
  if (!summary || !isValidSummary(summary)) return { kind: "unsupported" };

  const review = readSourceReview(runDir, summary);
  if (review === "unsupported") return { kind: "unsupported" };
  if (review.outcome === "ok") return { kind: "clean" };
  if (!isValidReview(review)) return { kind: "unsupported" };

  const files = sortedUnique(review.warnings.map((warning) => warning.file));
  const base = {
    runId: run.id,
    taskId: summary.taskId,
    commitRef: summary.commitSha,
    changedSourceFiles: summary.filesChanged.filter(isSourceSizeCheckPath).sort(),
    warningFamily: "source-size" as const,
    warningCount: review.warnings.length,
    files,
  };
  if (review.outcome === "exception") {
    return {
      kind: "record",
      record: {
        ...base,
        outcome: "cleanup-exception",
        cleanupCoverage: [
          {
            kind: "cleanup-exception",
            runId: run.id,
            taskId: summary.taskId,
            taskPath: review.exception.taskPath,
            files: review.exception.reducingFiles,
          },
        ],
      },
    };
  }
  return {
    kind: "record",
    record: {
      ...base,
      outcome: "warning",
      cleanupCoverage: findOpenCleanupCoverage(files, openTasks),
    },
  };
}

function readSummary(runDir: string): BuilderSummaryWithSourceSize | null {
  try {
    return JSON.parse(readFileSync(join(runDir, "run-summary.json"), "utf-8")) as BuilderSummaryWithSourceSize;
  } catch {
    return null;
  }
}

function readSourceReview(
  runDir: string,
  summary: BuilderSummaryWithSourceSize,
): SourceFileSizeReview | "unsupported" {
  const path = join(runDir, SOURCE_SIZE_REVIEW_ARTIFACT);
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf-8")) as ParsedSourceSizeReview;
      return normalizeReview(parsed);
    } catch {
      return "unsupported";
    }
  }
  if (summary.sourceFileSize) return normalizeReview(summary.sourceFileSize);
  if (Array.isArray(summary.warnings) && summary.warnings.length > 0) {
    return normalizeReview({
      outcome: "advisory",
      warnings: summary.warnings,
      message: "Legacy builder run summary source-size warnings",
    });
  }
  return "unsupported";
}

function normalizeReview(
  parsed: ParsedSourceSizeReview | SourceFileSizeReview,
): SourceFileSizeReview | "unsupported" {
  if (parsed.outcome === "ok") {
    if (!Array.isArray(parsed.warnings) || parsed.warnings.length > 0) return "unsupported";
    return { outcome: "ok", warnings: [], message: String(parsed.message ?? "") };
  }
  if (
    (parsed.outcome === "advisory" || parsed.outcome === "blocking" || parsed.outcome === "exception") &&
    Array.isArray(parsed.warnings)
  ) {
    const warnings = parsed.warnings.filter(isValidWarning) as SourceFileSizeWarning[];
    if (warnings.length !== parsed.warnings.length) return "unsupported";
    if (parsed.outcome === "exception") return normalizeExceptionReview(parsed, warnings);
    return {
      outcome: parsed.outcome,
      warnings,
      reasons: [],
      message: String(parsed.message ?? ""),
    };
  }
  return "unsupported";
}

function normalizeExceptionReview(
  parsed: ParsedSourceSizeReview | Extract<SourceFileSizeReview, { outcome: "exception" }>,
  warnings: SourceFileSizeWarning[],
): SourceFileSizeReview | "unsupported" {
  const exception = parsed.exception;
  if (
    !exception ||
    exception.kind !== "source-size-cleanup" ||
    typeof exception.taskPath !== "string" ||
    !Array.isArray(exception.files) ||
    !Array.isArray(exception.reducingFiles)
  ) {
    return "unsupported";
  }
  return {
    outcome: "exception",
    warnings,
    reasons: [],
    exception: {
      kind: "source-size-cleanup",
      taskPath: exception.taskPath,
      files: exception.files,
      reducingFiles: exception.reducingFiles,
    },
    message: String(parsed.message ?? ""),
  };
}

function isValidSummary(summary: BuilderSummaryWithSourceSize): boolean {
  return (
    summary.workflow === "builder" &&
    typeof summary.runId === "string" &&
    (typeof summary.taskId === "string" || summary.taskId === null) &&
    typeof summary.commitSha === "string" &&
    Array.isArray(summary.filesChanged) &&
    summary.filesChanged.every((file) => typeof file === "string")
  );
}

function isValidWarning(warning: Partial<SourceFileSizeWarning>): boolean {
  return (
    warning.type === SOURCE_FILE_SIZE_WARNING_TYPE &&
    typeof warning.file === "string" &&
    typeof warning.lines === "number" &&
    typeof warning.threshold === "number" &&
    typeof warning.changedLines === "number" &&
    typeof warning.message === "string"
  );
}

function isValidReview(review: SourceFileSizeReview): boolean {
  return review.warnings.every(isValidWarning);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
