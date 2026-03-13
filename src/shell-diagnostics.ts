/**
 * Smart error extraction from shell output.
 *
 * When shell commands fail with long output, naive head+tail truncation
 * often loses the critical error information buried in the middle.
 * This module detects common output formats (tsc, vitest/jest, eslint/biome,
 * generic errors) and extracts the most diagnostic-relevant lines.
 */

const EXTRACT_THRESHOLD = 8_000;

type Extraction = { text: string; count: number };
type Extractor = (output: string) => Extraction | null;

/**
 * Smart truncation for failed command output.
 * Short output is returned as-is. Long output gets error extraction
 * (with fallback to head+tail if no patterns match).
 */
export function smartErrorTruncate(output: string, limit = 20_000): string {
  if (output.length <= EXTRACT_THRESHOLD) return output;

  const extracted = runExtractors(output);
  if (extracted) {
    const tail = lastLines(output, 20);
    const header = `[Extracted ${extracted.count} diagnostic(s) from ${output.length} chars]\n`;
    return header + "\n" + extracted.text + "\n\n--- Output tail ---\n" + tail;
  }

  // Fallback: head + tail
  if (output.length <= limit) return output;
  const head = Math.floor(limit * 0.6);
  const end = Math.floor(limit * 0.3);
  return (
    output.slice(0, head) +
    `\n\n... [${output.length - head - end} chars omitted] ...\n\n` +
    output.slice(-end)
  );
}

function lastLines(text: string, n: number): string {
  return text.split("\n").slice(-n).join("\n").trim();
}

function runExtractors(output: string): Extraction | null {
  const extractors: Extractor[] = [
    extractTscErrors,
    extractTestFailures,
    extractLintErrors,
    extractGenericErrors,
  ];
  for (const ext of extractors) {
    const result = ext(output);
    if (result) return result;
  }
  return null;
}

// --- TypeScript compiler errors ---

const TSC_PAREN = /^(.+)\(\d+,\d+\):\s*error\s+TS\d+:/;
const TSC_COLON = /^(.+):\d+:\d+\s*-\s*error\s+TS\d+:/;

export function extractTscErrors(output: string): Extraction | null {
  const lines = output.split("\n");
  const errors: string[] = [];

  for (const line of lines) {
    if (TSC_PAREN.test(line) || TSC_COLON.test(line)) {
      errors.push(line.trim());
    }
  }
  if (errors.length === 0) return null;

  const unique = [...new Set(errors)].slice(0, 40);
  const text = `TypeScript errors (${unique.length}):\n` + unique.map((e) => `  ${e}`).join("\n");
  return { text, count: unique.length };
}

// --- Test runner failures (vitest, jest, mocha, generic) ---

const TEST_SUMMARY = /\bTests?\b.*\d+\s+(failed|passed)/i;
const TEST_FILE_FAIL = /^\s*FAIL\s+\S+\.(test|spec)\./i;
const FAIL_MARKER = /^\s*(FAIL|✗|×|✕)\s/;
const JEST_BULLET = /^\s*●\s/;
const ASSERTION = /AssertionError|Assertion failed/;
const EXPECT_LINE = /^\s*(Expected|Received|expect\()/;

export function extractTestFailures(output: string): Extraction | null {
  // Quick check: does this look like test output at all?
  if (!TEST_SUMMARY.test(output) && !TEST_FILE_FAIL.test(output)) return null;

  const lines = output.split("\n");
  const regions: string[] = [];
  const used = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;
    const line = lines[i];

    const isFailure =
      FAIL_MARKER.test(line) ||
      JEST_BULLET.test(line) ||
      ASSERTION.test(line) ||
      EXPECT_LINE.test(line);

    if (isFailure) {
      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length, i + 10);
      const block: string[] = [];
      for (let j = start; j < end; j++) {
        if (!used.has(j)) {
          used.add(j);
          block.push(lines[j]);
        }
      }
      regions.push(block.join("\n"));
    }
  }

  // Capture summary lines
  const summaries = lines.filter(
    (l) => TEST_SUMMARY.test(l) || /Test Files.*failed/i.test(l) || /Test Suites:.*failed/i.test(l),
  );

  if (regions.length === 0 && summaries.length === 0) return null;

  const parts: string[] = [];
  if (regions.length > 0) parts.push(regions.slice(0, 8).join("\n\n"));
  if (summaries.length > 0) parts.push(summaries.join("\n"));

  return { text: `Test failures:\n\n${parts.join("\n\n")}`, count: regions.length || 1 };
}

// --- Lint errors (eslint, biome) ---

const LINT_LINE = /^.+:\d+:\d+:\s*(error|warning)\s/;
const BIOME_MARKER = /^\s*×\s+.+/;

export function extractLintErrors(output: string): Extraction | null {
  const lines = output.split("\n");
  const errors: string[] = [];

  for (const line of lines) {
    if (LINT_LINE.test(line) || BIOME_MARKER.test(line)) {
      errors.push(line.trim());
    }
  }
  if (errors.length === 0) return null;

  const unique = [...new Set(errors)].slice(0, 40);
  // Prefer actual errors over warnings
  const errorsOnly = unique.filter((l) => /error/i.test(l) || /×/.test(l));
  const shown = errorsOnly.length > 0 ? errorsOnly : unique;
  const text = `Lint issues (${shown.length}):\n` + shown.map((e) => `  ${e}`).join("\n");
  return { text, count: shown.length };
}

// --- Generic error extraction ---

const ERROR_PATTERNS = [
  /\bError:\s/,
  /\bERROR\b/,
  /\bFAILED\b/,
  /\bfatal:/i,
  /\bpanic:/i,
  /Cannot find module/,
  /command not found/,
  /Permission denied/,
];

export function extractGenericErrors(output: string): Extraction | null {
  const lines = output.split("\n");
  const regions: string[] = [];
  const used = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;
    if (!ERROR_PATTERNS.some((p) => p.test(lines[i]))) continue;

    const start = Math.max(0, i - 1);
    const end = Math.min(lines.length, i + 4);
    const block: string[] = [];
    for (let j = start; j < end; j++) {
      if (!used.has(j)) {
        used.add(j);
        block.push(lines[j]);
      }
    }
    regions.push(block.join("\n"));
  }

  if (regions.length === 0) return null;

  const limited = regions.slice(0, 15);
  const text = `Errors (${regions.length} locations):\n\n` + limited.join("\n\n");
  return { text, count: regions.length };
}
