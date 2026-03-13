/**
 * Error context enrichment for shell output.
 *
 * When a shell command fails with errors that reference specific files and
 * line numbers (TypeScript, ESLint, stack traces, Python), this module
 * automatically reads the surrounding source code and appends it to the
 * error output. This saves the agent a turn — it can diagnose and fix
 * without a separate file_read.
 */

import { readFileSync, existsSync } from "node:fs";

export type FileRef = {
  path: string;
  line: number;
};

const SKIP_PATTERNS = [
  /node_modules\//,
  /\.git\//,
  /dist\//,
  /build\//,
  /coverage\//,
  /__pycache__\//,
  /^https?:/,
];

const MAX_REFS = 5;
const CONTEXT_RADIUS = 5;

// Patterns ordered by specificity (most specific first)
const PATTERNS: RegExp[] = [
  // TypeScript paren: src/file.ts(42,10): error TS...
  /([a-zA-Z0-9@_./-]+\.[a-z]{1,4})\((\d+),\d+\):\s*error/gm,
  // TypeScript colon: src/file.ts:42:10 - error TS...
  /([a-zA-Z0-9@_./-]+\.[a-z]{1,4}):(\d+):\d+\s*[-–]\s*error/gm,
  // ESLint/Biome: src/file.ts:42:10: error/warning
  /([a-zA-Z0-9@_./-]+\.[a-z]{1,4}):(\d+):\d+:\s*(?:error|warning)/gm,
  // Node.js stack: at Name (src/file.ts:42:10)
  /at\s+.*?\(([a-zA-Z0-9@_./-]+\.[a-z]{1,4}):(\d+):\d+\)/gm,
  // Node.js stack: at src/file.ts:42:10
  /at\s+([a-zA-Z0-9@_./-]+\.[a-z]{1,4}):(\d+):\d+$/gm,
  // Python: File "src/file.py", line 42
  /File\s+"([a-zA-Z0-9@_./-]+\.py)",\s*line\s+(\d+)/gm,
];

/**
 * Extract file:line references from error output.
 * Returns unique references to existing project files, max 5.
 */
export function extractFileReferences(output: string): FileRef[] {
  const refs: FileRef[] = [];
  const seen = new Set<string>();

  for (const pattern of PATTERNS) {
    // Reset lastIndex since we reuse compiled regexes
    pattern.lastIndex = 0;
    for (const match of output.matchAll(pattern)) {
      const path = match[1];
      const line = Number.parseInt(match[2], 10);
      const key = `${path}:${line}`;

      if (seen.has(key)) continue;
      if (SKIP_PATTERNS.some((p) => p.test(path))) continue;
      if (!existsSync(path)) continue;

      seen.add(key);
      refs.push({ path, line });

      if (refs.length >= MAX_REFS) return refs;
    }
  }

  return refs;
}

/**
 * Read lines around a target line from a file.
 * Returns formatted output with line numbers and a `>` marker on the target.
 */
export function readContextLines(path: string, targetLine: number, radius = CONTEXT_RADIUS): string | null {
  try {
    const content = readFileSync(path, "utf-8");
    const lines = content.split("\n");

    const start = Math.max(0, targetLine - 1 - radius);
    const end = Math.min(lines.length, targetLine - 1 + radius + 1);
    const width = String(end).length;

    const formatted: string[] = [];
    for (let i = start; i < end; i++) {
      const num = String(i + 1).padStart(width);
      const marker = i + 1 === targetLine ? ">" : " ";
      formatted.push(`${marker}${num}: ${lines[i]}`);
    }

    return formatted.join("\n");
  } catch {
    return null;
  }
}

/**
 * Merge references to nearby lines in the same file.
 * Keeps only the first reference when two are within `threshold` lines.
 */
function deduplicateRefs(refs: FileRef[], threshold = 10): FileRef[] {
  const result: FileRef[] = [];
  for (const ref of refs) {
    const nearby = result.find(
      (r) => r.path === ref.path && Math.abs(r.line - ref.line) <= threshold,
    );
    if (!nearby) result.push(ref);
  }
  return result;
}

/**
 * Enrich error output with source context from referenced files.
 * Extracts file:line references, reads surrounding lines, and appends
 * them so the agent can diagnose without a separate file_read turn.
 */
export function enrichWithSourceContext(output: string): string {
  const refs = extractFileReferences(output);
  if (refs.length === 0) return output;

  const unique = deduplicateRefs(refs);
  const sections: string[] = [];

  for (const ref of unique) {
    const context = readContextLines(ref.path, ref.line);
    if (context) {
      sections.push(`${ref.path}:${ref.line}:\n${context}`);
    }
  }

  if (sections.length === 0) return output;

  return output + "\n\n--- Referenced source ---\n" + sections.join("\n\n");
}
