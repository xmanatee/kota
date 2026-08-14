import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractTaskSections, REPO_TASKS_DIR } from "#modules/repo-tasks/repo-tasks-domain.js";
import {
  SOURCE_FILE_GROWTH_THRESHOLD,
  type SourceFileSizeChangedFile,
  type SourceFileSizeWarning,
  scanStagedSourceFileSizes,
} from "./source-size-check.js";
import { findOpenCleanupOverlap } from "./source-size-cleanup-overlap.js";

export const SOURCE_FILE_SIZE_SEVERE_TYPE = "source-file-size-severe";
export const SOURCE_FILE_SEVERE_BATCH_THRESHOLD = 4;
export const SOURCE_SIZE_EXCEPTION_SECTION = "Source Size Exception";
export const SOURCE_SIZE_CLEANUP_EXCEPTION_KIND = "source-size-cleanup";

export type SourceFileSizeBlockingReason =
  | {
      kind: "oversized-batch";
      files: string[];
      warningCount: number;
      threshold: number;
      message: string;
    }
  | {
      kind: "substantial-growth";
      files: string[];
      growthThreshold: number;
      message: string;
    }
  | {
      kind: "open-cleanup-overlap";
      files: string[];
      taskIds: string[];
      message: string;
    };

export type SourceFileSizeCleanupException = {
  kind: typeof SOURCE_SIZE_CLEANUP_EXCEPTION_KIND;
  taskPath: string;
  files: string[];
  reducingFiles: string[];
};

export type SourceFileSizeReview =
  | { outcome: "ok"; warnings: []; message: string }
  | { outcome: "advisory"; warnings: SourceFileSizeWarning[]; message: string }
  | {
      outcome: "blocking";
      warnings: SourceFileSizeWarning[];
      reasons: SourceFileSizeBlockingReason[];
      message: string;
    }
  | {
      outcome: "exception";
      warnings: SourceFileSizeWarning[];
      reasons: SourceFileSizeBlockingReason[];
      exception: SourceFileSizeCleanupException;
      message: string;
    };

function normalizePath(file: string): string {
  return file.replace(/\\/g, "/").trim();
}

function uniq(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function classifyBlockingReasons(
  projectDir: string,
  warnings: readonly SourceFileSizeWarning[],
): SourceFileSizeBlockingReason[] {
  const reasons: SourceFileSizeBlockingReason[] = [];
  if (warnings.length >= SOURCE_FILE_SEVERE_BATCH_THRESHOLD) {
    reasons.push({
      kind: "oversized-batch",
      files: warnings.map((warning) => warning.file),
      warningCount: warnings.length,
      threshold: SOURCE_FILE_SEVERE_BATCH_THRESHOLD,
      message:
        `${warnings.length} touched source file(s) are over the line guideline; ` +
        `the severe batch threshold is ${SOURCE_FILE_SEVERE_BATCH_THRESHOLD}.`,
    });
  }
  const growthFiles = warnings
    .filter((warning) => warning.changedLines > SOURCE_FILE_GROWTH_THRESHOLD)
    .map((warning) => warning.file);
  if (growthFiles.length > 0) {
    reasons.push({
      kind: "substantial-growth",
      files: growthFiles,
      growthThreshold: SOURCE_FILE_GROWTH_THRESHOLD,
      message:
        `Touched oversized source file(s) grew by more than ` +
        `${SOURCE_FILE_GROWTH_THRESHOLD} net line(s): ${growthFiles.join(", ")}.`,
    });
  }
  const overlap = findOpenCleanupOverlap(projectDir, warnings);
  if (overlap) reasons.push(overlap);
  return reasons;
}

function extractTaskException(raw: string, taskPath: string): SourceFileSizeCleanupException | null {
  const section = extractTaskSections(raw, [SOURCE_SIZE_EXCEPTION_SECTION])[
    SOURCE_SIZE_EXCEPTION_SECTION
  ];
  if (!section) return null;
  let kind: string | null = null;
  let readingFiles = false;
  const files: string[] = [];
  for (const rawLine of section.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const kindMatch = /^kind:\s*(\S+)\s*$/.exec(line);
    if (kindMatch) {
      kind = kindMatch[1];
      readingFiles = false;
      continue;
    }
    if (/^files:\s*$/.test(line)) {
      readingFiles = true;
      continue;
    }
    if (!readingFiles) continue;
    const fileMatch = /^-\s+(.+?)\s*$/.exec(line);
    if (fileMatch) {
      files.push(normalizePath(fileMatch[1]));
      continue;
    }
    if (/^[A-Za-z_-]+:/.test(line)) readingFiles = false;
  }
  if (kind !== SOURCE_SIZE_CLEANUP_EXCEPTION_KIND || files.length === 0) return null;
  return {
    kind: SOURCE_SIZE_CLEANUP_EXCEPTION_KIND,
    taskPath,
    files: uniq(files),
    reducingFiles: [],
  };
}

function readTaskException(projectDir: string, taskPath: string): SourceFileSizeCleanupException | null {
  try {
    const raw = readFileSync(join(projectDir, taskPath), "utf-8");
    return extractTaskException(raw, taskPath);
  } catch {
    return null;
  }
}

function taskPathsFromStagedFiles(changedFiles: readonly SourceFileSizeChangedFile[]): string[] {
  return changedFiles
    .map((file) => normalizePath(file.file))
    .filter(
      (file) =>
        file.startsWith(`${REPO_TASKS_DIR}/`) &&
        file.endsWith(".md") &&
        !file.endsWith("AGENTS.md") &&
        (file.includes("/doing/") ||
          file.includes("/blocked/") ||
          file.includes("/done/")),
    );
}

function doingTaskPaths(projectDir: string): string[] {
  const dir = join(projectDir, REPO_TASKS_DIR, "doing");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md") && name !== "AGENTS.md")
    .map((name) => `${REPO_TASKS_DIR}/doing/${name}`);
}

function findCleanupException(
  projectDir: string,
  changedFiles: readonly SourceFileSizeChangedFile[],
): SourceFileSizeCleanupException | null {
  for (const path of uniq([...taskPathsFromStagedFiles(changedFiles), ...doingTaskPaths(projectDir)])) {
    const exception = readTaskException(projectDir, path);
    if (exception) return exception;
  }
  return null;
}

function applyCleanupException(
  exception: SourceFileSizeCleanupException,
  warnings: readonly SourceFileSizeWarning[],
): SourceFileSizeCleanupException | null {
  const exceptionFiles = new Set(exception.files);
  const reducingWarnings = warnings.filter(
    (warning) => exceptionFiles.has(normalizePath(warning.file)) && warning.changedLines < 0,
  );
  if (reducingWarnings.length !== warnings.length) return null;
  return {
    ...exception,
    reducingFiles: reducingWarnings.map((warning) => warning.file),
  };
}

export function evaluateSourceFileSize(projectDir: string): SourceFileSizeReview {
  const scan = scanStagedSourceFileSizes(projectDir);
  if (scan.warnings.length === 0) {
    return {
      outcome: "ok",
      warnings: [],
      message: "OK: changed source files are under source-size warning thresholds",
    };
  }
  const reasons = classifyBlockingReasons(projectDir, scan.warnings);
  if (reasons.length === 0) {
    return {
      outcome: "advisory",
      warnings: scan.warnings,
      message: `Advisory source-size warning(s): ${scan.warnings.map((w) => w.file).join(", ")}.`,
    };
  }
  const exception = findCleanupException(projectDir, scan.changedFiles);
  const applied = exception ? applyCleanupException(exception, scan.warnings) : null;
  if (applied) {
    return {
      outcome: "exception",
      warnings: scan.warnings,
      reasons,
      exception: applied,
      message:
        `Typed source-size cleanup exception from ${applied.taskPath}; ` +
        `reducing ${applied.reducingFiles.join(", ")}.`,
    };
  }
  return {
    outcome: "blocking",
    warnings: scan.warnings,
    reasons,
    message: `Blocking severe source-size failure: ${reasons.map((reason) => reason.kind).join(", ")}.`,
  };
}

export function formatSourceFileSizeReview(review: SourceFileSizeReview): string {
  return JSON.stringify(review, null, 2);
}

export function formatSevereSourceFileSizeOutput(review: SourceFileSizeReview): string {
  if (review.outcome === "blocking") {
    throw new Error(
      [
        "Blocking severe source-size failure.",
        "Split cohesive helpers, narrow the implementation, or declare a typed source-size cleanup exception only for reducing cleanup work.",
        formatSourceFileSizeReview(review),
      ].join("\n"),
    );
  }
  if (review.outcome === "exception") {
    return `OK: typed source-size cleanup exception applied\n${formatSourceFileSizeReview(review)}`;
  }
  return review.message;
}

export function checkSevereSourceFileSize(projectDir: string): string {
  return formatSevereSourceFileSizeOutput(evaluateSourceFileSize(projectDir));
}
