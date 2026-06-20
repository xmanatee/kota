import { execFileSync } from "node:child_process";
import { withProtectedGitBareRepositoryEnv } from "#core/util/protected-git-env.js";
import { parseAddedLinesByFile, readStagedDiff } from "./staged-diff.js";

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
  const parts = normalized.split("/");
  if (parts.some((part) => SOURCE_FILE_SIZE_EXCLUDED_PATH_PARTS.some((excluded) => excluded === part))) {
    return false;
  }
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

export function detectSourceFileSizeWarnings(
  diff: string,
  readLineCount: (file: string) => number | null,
): SourceFileSizeWarning[] {
  const warnings: SourceFileSizeWarning[] = [];
  for (const fileDiff of parseAddedLinesByFile(diff)) {
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

function readStagedLineCount(projectDir: string, file: string): number | null {
  try {
    const content = execFileSync("git", ["show", `:${file}`], {
      cwd: projectDir,
      encoding: "utf8",
      env: withProtectedGitBareRepositoryEnv(),
      maxBuffer: 20 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return countLines(content);
  } catch {
    return null;
  }
}

export function checkSourceFileSize(projectDir: string): string {
  const diff = readStagedDiff(projectDir, ["."]);
  if (!diff.trim()) return "OK: no staged source changes";
  const warnings = detectSourceFileSizeWarnings(diff, (file) =>
    readStagedLineCount(projectDir, file),
  );
  if (warnings.length === 0) {
    return "OK: changed source files are under source-size warning thresholds";
  }
  throw new Error(formatSourceFileSizeWarnings(warnings));
}
