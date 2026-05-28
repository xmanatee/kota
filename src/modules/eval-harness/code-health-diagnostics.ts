import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, sep } from "node:path";
import { globSync } from "glob";
import type { FixtureRunOutcome } from "./fixture-run.js";

export const CODE_HEALTH_WARNING_CODES = [
  "source-size-growth",
  "duplicated-implementation-chunk",
  "complexity-concentration",
] as const;

export type CodeHealthWarningCode = (typeof CODE_HEALTH_WARNING_CODES)[number];

export type CodeHealthWarningCounts = {
  "source-size-growth": number;
  "duplicated-implementation-chunk": number;
  "complexity-concentration": number;
};

export type CodeHealthThresholds = {
  maxBaselineBytesGrowthRatio: number;
  maxPreviousBytesGrowthRatio: number;
  minSourceGrowthBytes: number;
  duplicateChunkLines: number;
  duplicateChunkMinOccurrences: number;
  maxLargestFileBytesShare: number;
  maxLargestFunctionLines: number;
};

export type CodeHealthDiagnosticsConfig = {
  sourceGlobs: readonly string[];
  excludeGlobs: readonly string[];
  thresholds: CodeHealthThresholds;
};

export type CodeHealthSourceFileMeasurement = {
  path: string;
  bytes: number;
  lines: number;
  implementationLines: number;
};

export type CodeHealthLargestFileMeasurement = {
  path: string;
  bytes: number;
  lines: number;
  shareOfBytes: number;
};

export type CodeHealthLargestFunctionMeasurement = {
  path: string;
  name: string;
  startLine: number;
  lines: number;
};

export type CodeHealthDuplicateChunkSample = {
  chunkHash: string;
  lineCount: number;
  occurrences: number;
  paths: readonly string[];
};

export type CodeHealthDuplicateChunkMeasurement = {
  chunkLineCount: number;
  duplicatedChunkCount: number;
  duplicatedOccurrenceCount: number;
  samples: readonly CodeHealthDuplicateChunkSample[];
};

export type CodeHealthMeasurement = {
  fileCount: number;
  totalBytes: number;
  totalLines: number;
  implementationLineCount: number;
  files: readonly CodeHealthSourceFileMeasurement[];
  largestFile: CodeHealthLargestFileMeasurement | null;
  largestFunction: CodeHealthLargestFunctionMeasurement | null;
  duplicateChunks: CodeHealthDuplicateChunkMeasurement;
};

export type CodeHealthGrowthBasis = "baseline" | "previous-round";

export type CodeHealthGrowthComparison = {
  basis: CodeHealthGrowthBasis;
  comparisonBytes: number;
  currentBytes: number;
  addedBytes: number;
  growthRatio: number | "infinite";
  thresholdRatio: number;
  minAddedBytes: number;
};

export type CodeHealthComplexitySignal =
  | {
      kind: "largest-file";
      path: string;
      shareOfBytes: number;
      thresholdShare: number;
    }
  | {
      kind: "largest-function";
      path: string;
      name: string;
      lines: number;
      thresholdLines: number;
    };

export type CodeHealthWarning =
  | {
      code: "source-size-growth";
      comparisons: readonly CodeHealthGrowthComparison[];
    }
  | {
      code: "duplicated-implementation-chunk";
      duplicatedChunkCount: number;
      duplicatedOccurrenceCount: number;
      samples: readonly CodeHealthDuplicateChunkSample[];
    }
  | {
      code: "complexity-concentration";
      signals: readonly CodeHealthComplexitySignal[];
    };

export type CodeHealthRoundDiagnostics = {
  roundId: string;
  roundIndex: number;
  outcome: FixtureRunOutcome;
  measurement: CodeHealthMeasurement;
  warnings: readonly CodeHealthWarning[];
  warningCounts: CodeHealthWarningCounts;
};

export type CodeHealthDiagnostics = {
  config: CodeHealthDiagnosticsConfig;
  baseline: CodeHealthMeasurement;
  rounds: readonly CodeHealthRoundDiagnostics[];
  warningCounts: CodeHealthWarningCounts;
};

export type CodeHealthAggregate = {
  diagnosticRunCount: number;
  runsWithWarnings: number;
  fixturesWithWarnings: number;
  totalWarnings: number;
  warningCounts: CodeHealthWarningCounts;
};

type CodeHealthJsonValue =
  | null
  | boolean
  | number
  | string
  | CodeHealthJsonValue[]
  | { [key: string]: CodeHealthJsonValue };

type ImplementationLine = {
  path: string;
  lineNumber: number;
  text: string;
};

type DuplicateChunkOccurrence = {
  path: string;
  startLine: number;
};

export type CodeHealthDiagnosticsValidationReason = "malformed-declaration";

export class CodeHealthDiagnosticsValidationError extends Error {
  readonly reason: CodeHealthDiagnosticsValidationReason;

  constructor(reason: CodeHealthDiagnosticsValidationReason, message: string) {
    super(message);
    this.name = "CodeHealthDiagnosticsValidationError";
    this.reason = reason;
  }
}

export const DEFAULT_CODE_HEALTH_THRESHOLDS: CodeHealthThresholds = {
  maxBaselineBytesGrowthRatio: 1.5,
  maxPreviousBytesGrowthRatio: 1.25,
  minSourceGrowthBytes: 256,
  duplicateChunkLines: 6,
  duplicateChunkMinOccurrences: 2,
  maxLargestFileBytesShare: 0.65,
  maxLargestFunctionLines: 80,
};

function isJsonObject(
  value: CodeHealthJsonValue | undefined,
): value is { [key: string]: CodeHealthJsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function malformed(fixtureDir: string, detail: string): CodeHealthDiagnosticsValidationError {
  return new CodeHealthDiagnosticsValidationError(
    "malformed-declaration",
    `Fixture at "${fixtureDir}" has invalid codeHealthDiagnostics: ${detail}`,
  );
}

function assertAllowedKeys(
  value: { [key: string]: CodeHealthJsonValue },
  fixtureDir: string,
  label: string,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw malformed(fixtureDir, `${label} declares unknown field "${key}".`);
    }
  }
}

function validateRelativeGlob(
  value: string,
  fixtureDir: string,
  label: string,
): string {
  if (value.length === 0) {
    throw malformed(fixtureDir, `${label} entries must be non-empty strings.`);
  }
  if (value.startsWith("!") || isAbsolute(value)) {
    throw malformed(
      fixtureDir,
      `${label} entry ${JSON.stringify(value)} must be a relative glob; use excludeGlobs for exclusions.`,
    );
  }
  const segments = value.split(/[\\/]+/);
  if (segments.some((segment) => segment === "..")) {
    throw malformed(
      fixtureDir,
      `${label} entry ${JSON.stringify(value)} must stay inside the fixture working directory.`,
    );
  }
  return value;
}

function parseGlobArray(
  raw: CodeHealthJsonValue | undefined,
  fixtureDir: string,
  label: string,
  required: boolean,
): readonly string[] {
  if (raw === undefined) {
    if (required) {
      throw malformed(fixtureDir, `${label} must be a non-empty array.`);
    }
    return [];
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw malformed(fixtureDir, `${label} must be a non-empty array of strings.`);
  }
  const globs: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") {
      throw malformed(
        fixtureDir,
        `${label} must be a non-empty array of strings.`,
      );
    }
    globs.push(validateRelativeGlob(entry, fixtureDir, label));
  }
  return globs;
}

function parsePositiveNumberThreshold(
  raw: CodeHealthJsonValue | undefined,
  fixtureDir: string,
  label: keyof CodeHealthThresholds,
  fallback: number,
): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    throw malformed(fixtureDir, `thresholds.${label} must be a positive number.`);
  }
  return raw;
}

function parseNonnegativeNumberThreshold(
  raw: CodeHealthJsonValue | undefined,
  fixtureDir: string,
  label: keyof CodeHealthThresholds,
  fallback: number,
): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    throw malformed(
      fixtureDir,
      `thresholds.${label} must be a non-negative number.`,
    );
  }
  return raw;
}

function parsePositiveIntegerThreshold(
  raw: CodeHealthJsonValue | undefined,
  fixtureDir: string,
  label: keyof CodeHealthThresholds,
  fallback: number,
  minimum: number,
): number {
  if (raw === undefined) return fallback;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < minimum) {
    throw malformed(
      fixtureDir,
      `thresholds.${label} must be an integer >= ${minimum}.`,
    );
  }
  return raw;
}

function parseShareThreshold(
  raw: CodeHealthJsonValue | undefined,
  fixtureDir: string,
  label: keyof CodeHealthThresholds,
  fallback: number,
): number {
  const parsed = parsePositiveNumberThreshold(raw, fixtureDir, label, fallback);
  if (parsed > 1) {
    throw malformed(fixtureDir, `thresholds.${label} must be <= 1.`);
  }
  return parsed;
}

function parseCodeHealthThresholds(
  raw: CodeHealthJsonValue | undefined,
  fixtureDir: string,
): CodeHealthThresholds {
  if (raw === undefined) return { ...DEFAULT_CODE_HEALTH_THRESHOLDS };
  if (!isJsonObject(raw)) {
    throw malformed(fixtureDir, "thresholds must be an object when present.");
  }
  assertAllowedKeys(raw, fixtureDir, "thresholds", [
    "maxBaselineBytesGrowthRatio",
    "maxPreviousBytesGrowthRatio",
    "minSourceGrowthBytes",
    "duplicateChunkLines",
    "duplicateChunkMinOccurrences",
    "maxLargestFileBytesShare",
    "maxLargestFunctionLines",
  ]);
  const thresholds: CodeHealthThresholds = {
    maxBaselineBytesGrowthRatio: parsePositiveNumberThreshold(
      raw.maxBaselineBytesGrowthRatio,
      fixtureDir,
      "maxBaselineBytesGrowthRatio",
      DEFAULT_CODE_HEALTH_THRESHOLDS.maxBaselineBytesGrowthRatio,
    ),
    maxPreviousBytesGrowthRatio: parsePositiveNumberThreshold(
      raw.maxPreviousBytesGrowthRatio,
      fixtureDir,
      "maxPreviousBytesGrowthRatio",
      DEFAULT_CODE_HEALTH_THRESHOLDS.maxPreviousBytesGrowthRatio,
    ),
    minSourceGrowthBytes: parseNonnegativeNumberThreshold(
      raw.minSourceGrowthBytes,
      fixtureDir,
      "minSourceGrowthBytes",
      DEFAULT_CODE_HEALTH_THRESHOLDS.minSourceGrowthBytes,
    ),
    duplicateChunkLines: parsePositiveIntegerThreshold(
      raw.duplicateChunkLines,
      fixtureDir,
      "duplicateChunkLines",
      DEFAULT_CODE_HEALTH_THRESHOLDS.duplicateChunkLines,
      2,
    ),
    duplicateChunkMinOccurrences: parsePositiveIntegerThreshold(
      raw.duplicateChunkMinOccurrences,
      fixtureDir,
      "duplicateChunkMinOccurrences",
      DEFAULT_CODE_HEALTH_THRESHOLDS.duplicateChunkMinOccurrences,
      2,
    ),
    maxLargestFileBytesShare: parseShareThreshold(
      raw.maxLargestFileBytesShare,
      fixtureDir,
      "maxLargestFileBytesShare",
      DEFAULT_CODE_HEALTH_THRESHOLDS.maxLargestFileBytesShare,
    ),
    maxLargestFunctionLines: parsePositiveIntegerThreshold(
      raw.maxLargestFunctionLines,
      fixtureDir,
      "maxLargestFunctionLines",
      DEFAULT_CODE_HEALTH_THRESHOLDS.maxLargestFunctionLines,
      1,
    ),
  };
  if (thresholds.maxBaselineBytesGrowthRatio <= 1) {
    throw malformed(
      fixtureDir,
      "thresholds.maxBaselineBytesGrowthRatio must be greater than 1.",
    );
  }
  if (thresholds.maxPreviousBytesGrowthRatio <= 1) {
    throw malformed(
      fixtureDir,
      "thresholds.maxPreviousBytesGrowthRatio must be greater than 1.",
    );
  }
  return thresholds;
}

export function parseCodeHealthDiagnosticsConfig(
  raw: CodeHealthJsonValue | undefined,
  fixtureDir: string,
): CodeHealthDiagnosticsConfig | undefined {
  if (raw === undefined) return undefined;
  if (!isJsonObject(raw)) {
    throw malformed(fixtureDir, "field must be an object.");
  }
  assertAllowedKeys(raw, fixtureDir, "field", [
    "sourceGlobs",
    "excludeGlobs",
    "thresholds",
  ]);
  return {
    sourceGlobs: parseGlobArray(raw.sourceGlobs, fixtureDir, "sourceGlobs", true),
    excludeGlobs: parseGlobArray(raw.excludeGlobs, fixtureDir, "excludeGlobs", false),
    thresholds: parseCodeHealthThresholds(raw.thresholds, fixtureDir),
  };
}

export function emptyCodeHealthWarningCounts(): CodeHealthWarningCounts {
  return {
    "source-size-growth": 0,
    "duplicated-implementation-chunk": 0,
    "complexity-concentration": 0,
  };
}

function totalWarnings(counts: CodeHealthWarningCounts): number {
  return (
    counts["source-size-growth"] +
    counts["duplicated-implementation-chunk"] +
    counts["complexity-concentration"]
  );
}

function mergeWarningCounts(
  target: CodeHealthWarningCounts,
  source: CodeHealthWarningCounts,
): void {
  target["source-size-growth"] += source["source-size-growth"];
  target["duplicated-implementation-chunk"] +=
    source["duplicated-implementation-chunk"];
  target["complexity-concentration"] += source["complexity-concentration"];
}

function countWarnings(
  warnings: readonly CodeHealthWarning[],
): CodeHealthWarningCounts {
  const counts = emptyCodeHealthWarningCounts();
  for (const warning of warnings) {
    counts[warning.code] += 1;
  }
  return counts;
}

function portablePath(path: string): string {
  return path.split(sep).join("/");
}

function listSourceFiles(
  workingDir: string,
  config: CodeHealthDiagnosticsConfig,
): readonly string[] {
  const files = new Set<string>();
  for (const pattern of config.sourceGlobs) {
    const matches = globSync(pattern, {
      cwd: workingDir,
      nodir: true,
      dot: true,
      ignore: [...config.excludeGlobs],
    });
    for (const match of matches) {
      const path = portablePath(match);
      const absolutePath = join(workingDir, path);
      if (existsSync(absolutePath) && statSync(absolutePath).isFile()) {
        files.add(path);
      }
    }
  }
  return [...files].sort((a, b) => a.localeCompare(b));
}

function lineCount(text: string): number {
  if (text.length === 0) return 0;
  return text.split(/\r\n|\r|\n/).length;
}

function normalizeImplementationLine(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  if (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("*/")
  ) {
    return null;
  }
  return trimmed.replace(/\s+/g, " ");
}

function functionCandidateName(line: string): string | null {
  const functionMatch = line.match(/\bfunction\s+([A-Za-z_$][\w$]*)/);
  if (functionMatch?.[1]) return functionMatch[1];
  const arrowMatch = line.match(
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/,
  );
  if (arrowMatch?.[1]) return arrowMatch[1];
  const methodMatch = line.match(/^\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/);
  if (methodMatch?.[1]) return methodMatch[1];
  if (line.includes("=>")) return "anonymous-arrow";
  return null;
}

function braceDelta(line: string): number {
  let delta = 0;
  for (const char of line) {
    if (char === "{") delta += 1;
    else if (char === "}") delta -= 1;
  }
  return delta;
}

function largestFunctionInFile(
  path: string,
  text: string,
): CodeHealthLargestFunctionMeasurement | null {
  const lines = text.split(/\r\n|\r|\n/);
  let largest: CodeHealthLargestFunctionMeasurement | null = null;
  for (let index = 0; index < lines.length; index++) {
    const name = functionCandidateName(lines[index]);
    if (name === null) continue;
    let balance = braceDelta(lines[index]);
    let end = index;
    if (!lines[index].includes("{")) {
      balance = 0;
    }
    while (balance > 0 && end + 1 < lines.length) {
      end += 1;
      balance += braceDelta(lines[end]);
    }
    const functionLines = end - index + 1;
    if (largest === null || functionLines > largest.lines) {
      largest = {
        path,
        name,
        startLine: index + 1,
        lines: functionLines,
      };
    }
  }
  return largest;
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function duplicateChunks(
  implementationLinesByPath: readonly (readonly ImplementationLine[])[],
  thresholds: CodeHealthThresholds,
): CodeHealthDuplicateChunkMeasurement {
  const byChunk = new Map<string, DuplicateChunkOccurrence[]>();
  for (const lines of implementationLinesByPath) {
    if (lines.length < thresholds.duplicateChunkLines) continue;
    for (let index = 0; index <= lines.length - thresholds.duplicateChunkLines; index++) {
      const chunk = lines
        .slice(index, index + thresholds.duplicateChunkLines)
        .map((line) => line.text)
        .join("\n");
      const occurrence = {
        path: lines[index].path,
        startLine: lines[index].lineNumber,
      };
      const bucket = byChunk.get(chunk);
      if (bucket) bucket.push(occurrence);
      else byChunk.set(chunk, [occurrence]);
    }
  }

  const samples: CodeHealthDuplicateChunkSample[] = [];
  let duplicatedOccurrenceCount = 0;
  for (const [chunk, occurrences] of byChunk) {
    if (occurrences.length < thresholds.duplicateChunkMinOccurrences) continue;
    duplicatedOccurrenceCount += occurrences.length;
    samples.push({
      chunkHash: hashText(chunk),
      lineCount: thresholds.duplicateChunkLines,
      occurrences: occurrences.length,
      paths: [...new Set(occurrences.map((occurrence) => occurrence.path))]
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 5),
    });
  }
  samples.sort(
    (a, b) =>
      b.occurrences - a.occurrences ||
      a.chunkHash.localeCompare(b.chunkHash),
  );
  return {
    chunkLineCount: thresholds.duplicateChunkLines,
    duplicatedChunkCount: samples.length,
    duplicatedOccurrenceCount,
    samples: samples.slice(0, 5),
  };
}

export function measureCodeHealth(
  workingDir: string,
  config: CodeHealthDiagnosticsConfig,
): CodeHealthMeasurement {
  const sourcePaths = listSourceFiles(workingDir, config);
  const files: CodeHealthSourceFileMeasurement[] = [];
  const implementationLinesByPath: ImplementationLine[][] = [];
  let largestFile: CodeHealthLargestFileMeasurement | null = null;
  let largestFunction: CodeHealthLargestFunctionMeasurement | null = null;
  let totalBytes = 0;
  let totalLines = 0;
  let implementationLineCount = 0;

  for (const path of sourcePaths) {
    const text = readFileSync(join(workingDir, path), "utf-8");
    const bytes = Buffer.byteLength(text, "utf-8");
    const lines = text.split(/\r\n|\r|\n/);
    const implementationLines: ImplementationLine[] = [];
    for (let index = 0; index < lines.length; index++) {
      const normalized = normalizeImplementationLine(lines[index]);
      if (normalized !== null) {
        implementationLines.push({
          path,
          lineNumber: index + 1,
          text: normalized,
        });
      }
    }
    const fileMeasurement = {
      path,
      bytes,
      lines: lineCount(text),
      implementationLines: implementationLines.length,
    };
    files.push(fileMeasurement);
    implementationLinesByPath.push(implementationLines);
    totalBytes += bytes;
    totalLines += fileMeasurement.lines;
    implementationLineCount += implementationLines.length;
    if (largestFile === null || bytes > largestFile.bytes) {
      largestFile = {
        path,
        bytes,
        lines: fileMeasurement.lines,
        shareOfBytes: 0,
      };
    }
    const fileLargestFunction = largestFunctionInFile(path, text);
    if (
      fileLargestFunction !== null &&
      (largestFunction === null || fileLargestFunction.lines > largestFunction.lines)
    ) {
      largestFunction = fileLargestFunction;
    }
  }

  if (largestFile !== null && totalBytes > 0) {
    largestFile = {
      ...largestFile,
      shareOfBytes: largestFile.bytes / totalBytes,
    };
  }

  return {
    fileCount: files.length,
    totalBytes,
    totalLines,
    implementationLineCount,
    files,
    largestFile,
    largestFunction,
    duplicateChunks: duplicateChunks(
      implementationLinesByPath,
      config.thresholds,
    ),
  };
}

function growthRatio(currentBytes: number, comparisonBytes: number): number | "infinite" {
  if (comparisonBytes === 0) {
    return currentBytes > 0 ? "infinite" : 1;
  }
  return currentBytes / comparisonBytes;
}

function exceedsGrowthThreshold(
  currentBytes: number,
  comparisonBytes: number,
  thresholdRatio: number,
  minAddedBytes: number,
): boolean {
  const addedBytes = currentBytes - comparisonBytes;
  if (addedBytes < minAddedBytes) return false;
  const ratio = growthRatio(currentBytes, comparisonBytes);
  return ratio === "infinite" || ratio > thresholdRatio;
}

function sourceGrowthWarning(params: {
  baseline: CodeHealthMeasurement;
  previous: CodeHealthMeasurement;
  current: CodeHealthMeasurement;
  thresholds: CodeHealthThresholds;
}): CodeHealthWarning | null {
  const comparisons: CodeHealthGrowthComparison[] = [];
  if (
    exceedsGrowthThreshold(
      params.current.totalBytes,
      params.baseline.totalBytes,
      params.thresholds.maxBaselineBytesGrowthRatio,
      params.thresholds.minSourceGrowthBytes,
    )
  ) {
    comparisons.push({
      basis: "baseline",
      comparisonBytes: params.baseline.totalBytes,
      currentBytes: params.current.totalBytes,
      addedBytes: params.current.totalBytes - params.baseline.totalBytes,
      growthRatio: growthRatio(
        params.current.totalBytes,
        params.baseline.totalBytes,
      ),
      thresholdRatio: params.thresholds.maxBaselineBytesGrowthRatio,
      minAddedBytes: params.thresholds.minSourceGrowthBytes,
    });
  }
  if (
    exceedsGrowthThreshold(
      params.current.totalBytes,
      params.previous.totalBytes,
      params.thresholds.maxPreviousBytesGrowthRatio,
      params.thresholds.minSourceGrowthBytes,
    )
  ) {
    comparisons.push({
      basis: "previous-round",
      comparisonBytes: params.previous.totalBytes,
      currentBytes: params.current.totalBytes,
      addedBytes: params.current.totalBytes - params.previous.totalBytes,
      growthRatio: growthRatio(
        params.current.totalBytes,
        params.previous.totalBytes,
      ),
      thresholdRatio: params.thresholds.maxPreviousBytesGrowthRatio,
      minAddedBytes: params.thresholds.minSourceGrowthBytes,
    });
  }
  if (comparisons.length === 0) return null;
  return { code: "source-size-growth", comparisons };
}

function duplicateChunkWarning(
  current: CodeHealthMeasurement,
): CodeHealthWarning | null {
  if (current.duplicateChunks.duplicatedChunkCount === 0) return null;
  return {
    code: "duplicated-implementation-chunk",
    duplicatedChunkCount: current.duplicateChunks.duplicatedChunkCount,
    duplicatedOccurrenceCount: current.duplicateChunks.duplicatedOccurrenceCount,
    samples: current.duplicateChunks.samples,
  };
}

function complexityWarning(
  current: CodeHealthMeasurement,
  thresholds: CodeHealthThresholds,
): CodeHealthWarning | null {
  const signals: CodeHealthComplexitySignal[] = [];
  if (
    current.fileCount > 1 &&
    current.largestFile !== null &&
    current.largestFile.shareOfBytes > thresholds.maxLargestFileBytesShare
  ) {
    signals.push({
      kind: "largest-file",
      path: current.largestFile.path,
      shareOfBytes: current.largestFile.shareOfBytes,
      thresholdShare: thresholds.maxLargestFileBytesShare,
    });
  }
  if (
    current.largestFunction !== null &&
    current.largestFunction.lines > thresholds.maxLargestFunctionLines
  ) {
    signals.push({
      kind: "largest-function",
      path: current.largestFunction.path,
      name: current.largestFunction.name,
      lines: current.largestFunction.lines,
      thresholdLines: thresholds.maxLargestFunctionLines,
    });
  }
  if (signals.length === 0) return null;
  return { code: "complexity-concentration", signals };
}

export function evaluateCodeHealthRound(params: {
  config: CodeHealthDiagnosticsConfig;
  workingDir: string;
  baseline: CodeHealthMeasurement;
  previous: CodeHealthMeasurement;
  roundId: string;
  roundIndex: number;
  outcome: FixtureRunOutcome;
}): CodeHealthRoundDiagnostics {
  const measurement = measureCodeHealth(params.workingDir, params.config);
  const warnings = [
    sourceGrowthWarning({
      baseline: params.baseline,
      previous: params.previous,
      current: measurement,
      thresholds: params.config.thresholds,
    }),
    duplicateChunkWarning(measurement),
    complexityWarning(measurement, params.config.thresholds),
  ].filter((warning): warning is CodeHealthWarning => warning !== null);
  return {
    roundId: params.roundId,
    roundIndex: params.roundIndex,
    outcome: params.outcome,
    measurement,
    warnings,
    warningCounts: countWarnings(warnings),
  };
}

export function finalizeCodeHealthDiagnostics(params: {
  config: CodeHealthDiagnosticsConfig;
  baseline: CodeHealthMeasurement;
  rounds: readonly CodeHealthRoundDiagnostics[];
}): CodeHealthDiagnostics {
  const warningCounts = emptyCodeHealthWarningCounts();
  for (const round of params.rounds) {
    mergeWarningCounts(warningCounts, round.warningCounts);
  }
  return {
    config: params.config,
    baseline: params.baseline,
    rounds: params.rounds,
    warningCounts,
  };
}

export function aggregateCodeHealthDiagnostics(
  runs: readonly {
    fixtureId: string;
    codeHealthDiagnostics?: CodeHealthDiagnostics;
  }[],
): CodeHealthAggregate {
  const warningCounts = emptyCodeHealthWarningCounts();
  const fixturesWithWarnings = new Set<string>();
  let diagnosticRunCount = 0;
  let runsWithWarnings = 0;
  for (const run of runs) {
    if (run.codeHealthDiagnostics === undefined) continue;
    diagnosticRunCount += 1;
    mergeWarningCounts(warningCounts, run.codeHealthDiagnostics.warningCounts);
    if (totalWarnings(run.codeHealthDiagnostics.warningCounts) > 0) {
      runsWithWarnings += 1;
      fixturesWithWarnings.add(run.fixtureId);
    }
  }
  return {
    diagnosticRunCount,
    runsWithWarnings,
    fixturesWithWarnings: fixturesWithWarnings.size,
    totalWarnings: totalWarnings(warningCounts),
    warningCounts,
  };
}
