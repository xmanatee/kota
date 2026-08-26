import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  readWorkspaceChangeEvidence,
  type WorkspaceChange,
  WorkspaceChangeOutputLimitError,
} from "#core/workflow/workspace-change-evidence.js";
import { type FileDiff, parseAddedLinesByFile } from "./workflow-diff.js";

export const SOURCE_FILE_SIZE_WARNING_TYPE = "source-file-size";
export const SOURCE_FILE_LINE_THRESHOLD = 300;
export const SOURCE_FILE_GROWTH_THRESHOLD = 150;

export const SOURCE_FILE_SIZE_EXCLUDED_PATH_PARTS = [
  ".kota",
  ".next",
  "build",
  "coverage",
  "dist",
  "generated",
  "__generated__",
  "node_modules",
  "out",
  "vendor",
  "vendors",
  "third_party",
] as const;

const SOURCE_FILE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".go",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".mjs",
  ".mts",
  ".py",
  ".rs",
  ".sh",
  ".swift",
  ".ts",
  ".tsx",
]);

export type SourceFileSizeWarning = {
  type: typeof SOURCE_FILE_SIZE_WARNING_TYPE;
  file: string;
  lines: number;
  threshold: number;
  changedLines: number;
  message: string;
};

export type SourceFileSizeChangedFile = {
  file: string;
  changedLines: number;
};

export type SourceFileSizeScan = {
  diff: string;
  changedFiles: SourceFileSizeChangedFile[];
  warnings: SourceFileSizeWarning[];
};

function normalizePath(file: string): string {
  return file.replace(/\\/g, "/");
}

function extensionOf(file: string): string {
  const name = file.split("/").pop() ?? file;
  if (name.endsWith(".d.ts")) return ".d.ts";
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot) : "";
}

export function isSourceSizeCheckPath(file: string): boolean {
  const normalized = normalizePath(file);
  if (normalized.startsWith(".") && !normalized.startsWith("./")) return false;
  const parts = normalized.toLowerCase().split("/");
  if (parts.some((part) => SOURCE_FILE_SIZE_EXCLUDED_PATH_PARTS.some((excluded) => excluded === part))) {
    return false;
  }
  if (parts.at(-1)?.includes(".generated.")) return false;
  return SOURCE_FILE_EXTENSIONS.has(extensionOf(normalized));
}

function countLines(content: string): number {
  if (content.length === 0) return 0;
  const lines = content.split("\n").length;
  return content.endsWith("\n") ? lines - 1 : lines;
}

function buildWarning(file: string, lines: number, changedLines: number): SourceFileSizeWarning {
  const growth =
    changedLines > SOURCE_FILE_GROWTH_THRESHOLD
      ? ` and grew by ${changedLines} net line(s), above the ${SOURCE_FILE_GROWTH_THRESHOLD}-line growth threshold`
      : "";
  return {
    type: SOURCE_FILE_SIZE_WARNING_TYPE,
    file,
    lines,
    threshold: SOURCE_FILE_LINE_THRESHOLD,
    changedLines,
    message:
      `Changed source file ${file} is ${lines} line(s), above the ` +
      `${SOURCE_FILE_LINE_THRESHOLD}-line source-size guideline${growth}.`,
  };
}

function toChangedFile(fileDiff: FileDiff): SourceFileSizeChangedFile {
  return {
    file: fileDiff.file,
    changedLines: fileDiff.addedLines.length - fileDiff.deletedLines.length,
  };
}

function detectSourceFileSizeWarningsFromFileDiffs(
  fileDiffs: readonly FileDiff[],
  readLineCount: (file: string) => number | null,
): SourceFileSizeWarning[] {
  const warnings: SourceFileSizeWarning[] = [];
  for (const fileDiff of fileDiffs) {
    if (!isSourceSizeCheckPath(fileDiff.file)) continue;
    const lines = readLineCount(fileDiff.file);
    if (lines === null) continue;
    const changedLines = fileDiff.addedLines.length - fileDiff.deletedLines.length;
    const oversized = lines > SOURCE_FILE_LINE_THRESHOLD;
    const oversizedGrowth =
      changedLines > SOURCE_FILE_GROWTH_THRESHOLD &&
      lines > SOURCE_FILE_LINE_THRESHOLD;
    if (!oversized && !oversizedGrowth) continue;
    warnings.push(buildWarning(fileDiff.file, lines, changedLines));
  }
  return warnings;
}

export function detectSourceFileSizeWarnings(
  diff: string,
  readLineCount: (file: string) => number | null,
): SourceFileSizeWarning[] {
  return detectSourceFileSizeWarningsFromFileDiffs(
    parseAddedLinesByFile(diff),
    readLineCount,
  );
}

export function formatSourceFileSizeWarnings(
  warnings: readonly SourceFileSizeWarning[],
): string {
  return JSON.stringify(warnings, null, 2);
}

export function parseSourceFileSizeWarnings(text: string): SourceFileSizeWarning[] {
  let parsed: SourceFileSizeWarning[];
  try {
    parsed = JSON.parse(text) as SourceFileSizeWarning[];
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (item) =>
      item?.type === SOURCE_FILE_SIZE_WARNING_TYPE &&
      typeof item.file === "string" &&
      typeof item.lines === "number" &&
      typeof item.threshold === "number" &&
      typeof item.changedLines === "number" &&
      typeof item.message === "string",
  ) as SourceFileSizeWarning[];
}

export function extractSourceFileSizeWarningsFromBuildOutput(
  buildOutput: { repairWarnings?: readonly { id?: string; output?: string }[] } | undefined,
): SourceFileSizeWarning[] {
  const repairWarnings = buildOutput?.repairWarnings ?? [];
  return repairWarnings.flatMap((warning) => {
    if (warning.id !== SOURCE_FILE_SIZE_WARNING_TYPE || typeof warning.output !== "string") {
      return [];
    }
    return parseSourceFileSizeWarnings(warning.output);
  });
}

function fileDiffsForChanges(
  diff: string,
  changes: readonly WorkspaceChange[],
): FileDiff[] {
  const parsedByPath = new Map(
    parseAddedLinesByFile(diff)
      .filter((fileDiff) => fileDiff.file.length > 0)
      .map((fileDiff) => [fileDiff.file, fileDiff]),
  );
  return changes.map((change) =>
    parsedByPath.get(change.path) ?? {
      file: change.path,
      addedLines: [],
      deletedLines: [],
    }
  );
}

function readWorkspaceLineCount(
  projectDir: string,
  changeByPath: ReadonlyMap<string, WorkspaceChange>,
  file: string,
): number | null {
  const change = changeByPath.get(file);
  if (change === undefined) {
    throw new Error(`Missing workspace change status for source file ${file}`);
  }
  if (change.status === "deleted") return null;
  return countLines(readFileSync(join(projectDir, file), "utf8"));
}

export function scanWorkspaceSourceFileSizes(projectDir: string): SourceFileSizeScan {
  const evidence = readWorkspaceChangeEvidence(projectDir, {
    pathspecs: ["."],
    unifiedLines: 0,
  });
  if (evidence.diff.truncated) {
    throw new WorkspaceChangeOutputLimitError("diff", evidence.diff.limitBytes);
  }
  const diff = evidence.diff.text;
  if (evidence.changes.length === 0) {
    return { diff, changedFiles: [], warnings: [] };
  }
  const fileDiffs = fileDiffsForChanges(diff, evidence.changes);
  const changeByPath = new Map(
    evidence.changes.map((change) => [change.path, change]),
  );
  return {
    diff,
    changedFiles: fileDiffs.map(toChangedFile),
    warnings: detectSourceFileSizeWarningsFromFileDiffs(fileDiffs, (file) =>
      readWorkspaceLineCount(projectDir, changeByPath, file)
    ),
  };
}

export function checkSourceFileSize(projectDir: string): string {
  const { changedFiles, warnings } = scanWorkspaceSourceFileSizes(projectDir);
  if (changedFiles.length === 0) return "OK: no workspace source changes";
  if (warnings.length === 0) {
    return "OK: changed source files are under source-size warning thresholds";
  }
  throw new Error(formatSourceFileSizeWarnings(warnings));
}
