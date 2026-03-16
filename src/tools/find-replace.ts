import { readFileSync, writeFileSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import { glob } from "glob";
import { recordModification } from "../file-tracker.js";
import { lintFile } from "../lint.js";
import type { ToolResult } from "./index.js";

const MAX_FILES = 50;
const MAX_GLOB = 1000;

export const findReplaceTool: Anthropic.Tool = {
  name: "find_replace",
  description:
    "Find and replace text across multiple files matching a glob pattern. " +
    "Supports literal strings, regex with capture groups, and word-boundary matching. " +
    "Lint-gated: reverts all changes if any file gets syntax errors.",
  input_schema: {
    type: "object" as const,
    properties: {
      pattern: {
        type: "string",
        description: "Text or regex pattern to find",
      },
      replacement: {
        type: "string",
        description:
          "Replacement text. In regex mode, supports $1, $2 for capture groups.",
      },
      files: {
        type: "string",
        description: "Glob pattern for target files (e.g., 'src/**/*.ts')",
      },
      is_regex: {
        type: "boolean",
        description: "Treat pattern as regex (default: false)",
      },
      dry_run: {
        type: "boolean",
        description: "Preview changes without applying (default: false)",
      },
      word_boundary: {
        type: "boolean",
        description: "Match whole words only (default: false)",
      },
    },
    required: ["pattern", "replacement", "files"],
  },
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type MatchResult = { count: number; result: string };

/** Apply a find-replace on a single string. Exported for testing. */
export function applyReplacement(
  content: string,
  pattern: string,
  replacement: string,
  isRegex: boolean,
  wordBoundary: boolean,
): MatchResult {
  // Literal mode without word boundary — fully string-based, no regex quirks
  if (!isRegex && !wordBoundary) {
    const parts = content.split(pattern);
    return { count: parts.length - 1, result: parts.join(replacement) };
  }
  // Regex mode (or word-boundary which requires regex)
  let source = isRegex ? pattern : escapeRegex(pattern);
  if (wordBoundary) source = `\\b${source}\\b`;
  const regex = new RegExp(source, "g");
  const matches = content.match(regex);
  const count = matches ? matches.length : 0;
  // For non-regex mode, escape $ in replacement so it's treated literally
  const safeReplacement = isRegex
    ? replacement
    : replacement.replace(/\$/g, "$$$$");
  return { count, result: content.replace(regex, safeReplacement) };
}

/** Revert files to originals. Returns list of paths that failed to revert. */
function revertOriginals(originals: Map<string, string>): string[] {
  const failures: string[] = [];
  for (const [p, orig] of originals) {
    try {
      writeFileSync(p, orig, "utf-8");
      recordModification(p);
    } catch {
      failures.push(p);
    }
  }
  return failures;
}

export async function runFindReplace(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const pattern = input.pattern as string;
  const replacement = input.replacement as string;
  const filesGlob = input.files as string;
  const isRegex = (input.is_regex as boolean) ?? false;
  const dryRun = (input.dry_run as boolean) ?? false;
  const wordBoundary = (input.word_boundary as boolean) ?? false;

  if (!pattern)
    return { content: "Error: pattern is required", is_error: true };
  if (replacement === undefined)
    return { content: "Error: replacement is required", is_error: true };
  if (!filesGlob)
    return { content: "Error: files glob pattern is required", is_error: true };

  // Validate regex early
  if (isRegex || wordBoundary) {
    try {
      const src = isRegex ? pattern : escapeRegex(pattern);
      new RegExp(wordBoundary ? `\\b${src}\\b` : src);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: `Error: invalid regex: ${msg}`, is_error: true };
    }
  }

  const matchedFiles = await glob(filesGlob, {
    nodir: true,
    dot: true,
    ignore: ["**/node_modules/**", "**/.git/**"],
  });

  if (matchedFiles.length === 0) {
    return { content: `No files match glob: ${filesGlob}`, is_error: true };
  }

  if (matchedFiles.length > MAX_GLOB) {
    return {
      content:
        `Glob matched ${matchedFiles.length} files (limit: ${MAX_GLOB}). ` +
        `Narrow the pattern. Example: 'src/**/*.ts' instead of '**/*'.`,
      is_error: true,
    };
  }

  // Scan for matches
  type Hit = { path: string; count: number; content: string; result: string };
  const hits: Hit[] = [];
  for (const fp of matchedFiles) {
    let content: string;
    try {
      content = readFileSync(fp, "utf-8");
    } catch {
      continue;
    }
    if (content.includes('\0')) continue;
    const { count, result } = applyReplacement(
      content,
      pattern,
      replacement,
      isRegex,
      wordBoundary,
    );
    if (count > 0) hits.push({ path: fp, count, content, result });
  }

  if (hits.length === 0) {
    return {
      content: `No matches for "${pattern}" in files matching ${filesGlob}`,
    };
  }

  if (hits.length > MAX_FILES) {
    return {
      content:
        `Too many files with matches (${hits.length}). ` +
        `Max ${MAX_FILES}. Narrow the glob pattern.`,
      is_error: true,
    };
  }

  const total = hits.reduce((s, h) => s + h.count, 0);

  if (dryRun) {
    const lines = hits
      .map((h) => `  ${h.path}: ${h.count} match(es)`)
      .join("\n");
    return {
      content: `Dry run — ${total} match(es) in ${hits.length} file(s):\n${lines}`,
    };
  }

  // Apply with rollback support
  const originals = new Map<string, string>();
  for (const h of hits) originals.set(h.path, h.content);

  const modified: string[] = [];
  try {
    for (const h of hits) {
      writeFileSync(h.path, h.result, "utf-8");
      const lint = lintFile(h.path);
      if (!lint.ok) {
        const revertFailures = revertOriginals(originals);
        const revertMsg = revertFailures.length > 0
          ? `\nFailed to revert ${revertFailures.length} file(s): ${revertFailures.join(", ")}`
          : "\nAll changes reverted.";
        return {
          content:
            `Syntax error in ${h.path} after replacement:\n${lint.error}${revertMsg}`,
          is_error: true,
        };
      }
      modified.push(h.path);
    }
  } catch (err) {
    const revertFailures = revertOriginals(originals);
    const msg = err instanceof Error ? err.message : String(err);
    const revertMsg = revertFailures.length > 0
      ? `Failed to revert ${revertFailures.length} file(s): ${revertFailures.join(", ")}`
      : "All changes reverted.";
    return { content: `Write failed: ${msg}. ${revertMsg}`, is_error: true };
  }

  for (const p of modified) recordModification(p);

  const lines = modified
    .map((p) => `  ${p}: ${hits.find((h) => h.path === p)!.count} replacement(s)`)
    .join("\n");

  return {
    content: `Replaced ${total} occurrence(s) in ${modified.length} file(s):\n${lines}`,
  };
}
