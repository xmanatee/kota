import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { WorkflowRunMetadata } from "#core/workflow/run-types.js";
import {
  type AutonomyRunDeliveryEvidence,
  readAutonomyRunDeliveryEvidence,
} from "#modules/autonomy/run-delivery-evidence.js";
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
  const delivery = readAutonomyRunDeliveryEvidence(runsDir, run);
  if (!delivery || !isValidDelivery(delivery)) return { kind: "unsupported" };

  const review = readSourceReview(runDir);
  if (review === "unsupported") return { kind: "unsupported" };
  if (review.outcome === "ok") return { kind: "clean" };
  if (!isValidReview(review)) return { kind: "unsupported" };

  const files = sortedUnique(review.warnings.map((warning) => warning.file));
  const base = {
    runId: run.id,
    taskId: delivery.taskId,
    commitRef: delivery.publishedHead,
    changedSourceFiles: delivery.changedPaths.filter(isSourceSizeCheckPath).sort(),
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
            taskId: delivery.taskId,
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

function readSourceReview(
  runDir: string,
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

function isValidDelivery(delivery: AutonomyRunDeliveryEvidence): boolean {
  return (
    delivery.workflow === "builder" &&
    typeof delivery.runId === "string" &&
    (typeof delivery.taskId === "string" || delivery.taskId === null) &&
    typeof delivery.publishedHead === "string" &&
    Array.isArray(delivery.changedPaths) &&
    delivery.changedPaths.every((file) => typeof file === "string")
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
