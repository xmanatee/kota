import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import { printEditDiff } from "../diff.js";
import { checkFreshness, recordModification } from "../file-tracker.js";
import { lintFile } from "../lint.js";
import { fileNotFoundError } from "../path-resolver.js";
import type { ToolResult } from "./index.js";

export const fileEditTool: Anthropic.Tool = {
  name: "file_edit",
  description:
    "Edit a file by replacing an exact string with a new string. " +
    "The old_string must match exactly (including whitespace/indentation). " +
    "If old_string appears multiple times, set replace_all to true " +
    "or provide more context to make it unique. " +
    "This is the safest way to modify existing files.",
  input_schema: {
    type: "object" as const,
    properties: {
      path: {
        type: "string",
        description: "Path to the file to edit",
      },
      old_string: {
        type: "string",
        description: "The exact string to find and replace",
      },
      new_string: {
        type: "string",
        description: "The replacement string",
      },
      replace_all: {
        type: "boolean",
        description: "Replace all occurrences (default: false)",
      },
    },
    required: ["path", "old_string", "new_string"],
  },
};

export async function runFileEdit(
  input: Record<string, unknown>,
): Promise<ToolResult> {
  const path = input.path as string;
  const oldStr = input.old_string as string;
  const newStr = input.new_string as string;
  const replaceAll = (input.replace_all as boolean) || false;

  if (!path) return { content: "Error: path is required", is_error: true };
  if (!oldStr) return { content: "Error: old_string is required", is_error: true };
  if (newStr === undefined) return { content: "Error: new_string is required", is_error: true };
  if (oldStr === newStr) return { content: "Error: old_string and new_string are identical", is_error: true };

  if (!existsSync(path)) {
    return { content: fileNotFoundError(path), is_error: true };
  }
  try {
    if (statSync(path).isDirectory()) {
      return { content: `Error: ${path} is a directory, not a file`, is_error: true };
    }
  } catch {}

  const staleWarning = checkFreshness(path);

  const content = readFileSync(path, "utf-8");
  const count = content.split(oldStr).length - 1;

  if (count === 0) {
    // Try whitespace-tolerant match before falling to fuzzy error
    const wsMatch = tryWhitespaceMatch(content, oldStr);
    if (wsMatch) {
      const updated = content.replace(wsMatch, () => newStr);
      writeFileSync(path, updated, "utf-8");

      const lintResult = lintFile(path);
      if (!lintResult.ok) {
        writeFileSync(path, content, "utf-8");
        recordModification(path);
        return {
          content:
            `Edit reverted — syntax error detected:\n${lintResult.error}\n\n` +
            `The file has been restored. Fix the syntax in your replacement and try again.`,
          is_error: true,
        };
      }

      recordModification(path);
      const line = content.slice(0, content.indexOf(wsMatch)).split("\n").length;
      printEditDiff(path, content, wsMatch, newStr);
      return {
        content:
          `Applied with whitespace correction at line ${line} in ${path}. ` +
          `(Indentation/whitespace in old_string didn't match exactly, but content matched.)`,
      };
    }

    const msg = buildNotFoundMessage(path, content, oldStr);
    return {
      content: staleWarning ? `${staleWarning}\n\n${msg}` : msg,
      is_error: true,
    };
  }

  if (count > 1 && !replaceAll) {
    return {
      content:
        `Error: old_string appears ${count} times in ${path}. ` +
        `Provide more surrounding context to make it unique, ` +
        `or set replace_all to true.`,
      is_error: true,
    };
  }

  const updated = replaceAll
    ? content.replaceAll(oldStr, () => newStr)
    : content.replace(oldStr, () => newStr);

  writeFileSync(path, updated, "utf-8");

  // Linter-gated: syntax check after edit, revert on failure
  const lintResult = lintFile(path);
  if (!lintResult.ok) {
    writeFileSync(path, content, "utf-8"); // revert
    recordModification(path);
    return {
      content:
        `Edit reverted — syntax error detected:\n${lintResult.error}\n\n` +
        `The file has been restored. Fix the syntax in your replacement and try again.`,
      is_error: true,
    };
  }

  recordModification(path);
  const replacements = replaceAll ? count : 1;
  printEditDiff(path, content, oldStr, newStr);
  return { content: `Replaced ${replacements} occurrence(s) in ${path}` };
}

/**
 * Normalize whitespace for tolerant matching: trim each line, collapse blank lines.
 * Preserves the non-whitespace content for comparison.
 */
export function normalizeWhitespace(s: string): string {
  return s
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * Try to find old_string in content using whitespace-tolerant matching.
 * Returns the exact matched region from the file if found (so it can be replaced),
 * or null if no match / ambiguous (multiple matches).
 *
 * Only matches when the non-whitespace content is identical — prevents false
 * positives from semantically different code that happens to look similar.
 * Requires at least 10 non-whitespace characters to avoid trivial matches.
 */
export function tryWhitespaceMatch(content: string, oldStr: string): string | null {
  const normOld = normalizeWhitespace(oldStr);
  // Skip trivially short searches — too high risk of false match
  if (normOld.replace(/\s/g, "").length < 10) return null;

  const lines = content.split("\n");
  // Use normalized line count — blank lines in the search collapse during normalization
  const normLineCount = normOld.split("\n").length;

  // Try window sizes from normLineCount up to normLineCount+4
  // to handle cases where the file has blank lines the search doesn't (or vice versa).
  // Return as soon as one window size yields exactly one unambiguous match.
  for (let ws = normLineCount; ws <= normLineCount + 4 && ws <= lines.length; ws++) {
    let count = 0;
    let region = "";
    for (let i = 0; i <= lines.length - ws; i++) {
      const window = lines.slice(i, i + ws).join("\n");
      if (normalizeWhitespace(window) === normOld) {
        count++;
        if (count > 1) break; // Ambiguous at this window size
        region = window;
      }
    }
    if (count === 1) return region;
  }

  return null;
}

/**
 * Compute similarity between two strings using bigram overlap (Dice coefficient).
 * Fast, no dependencies, good enough for finding near-matches.
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bi = a.slice(i, i + 2);
    bigrams.set(bi, (bigrams.get(bi) || 0) + 1);
  }

  let overlap = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bi = b.slice(i, i + 2);
    const count = bigrams.get(bi) || 0;
    if (count > 0) {
      bigrams.set(bi, count - 1);
      overlap++;
    }
  }

  return (2 * overlap) / (a.length - 1 + b.length - 1);
}

/**
 * Build an error message when old_string is not found.
 * Finds the most similar region in the file and shows it with context.
 */
export function buildNotFoundMessage(path: string, content: string, oldStr: string): string {
  const lines = content.split("\n");
  const searchLines = oldStr.split("\n");
  const windowSize = searchLines.length;

  // Slide a window over the file lines, score each window against the search
  let bestScore = 0;
  let bestLineIdx = 0;

  for (let i = 0; i <= lines.length - windowSize; i++) {
    const window = lines.slice(i, i + windowSize).join("\n");
    const score = similarity(window, oldStr);
    if (score > bestScore) {
      bestScore = score;
      bestLineIdx = i;
    }
  }

  // Also check single-line matches if old_string is one line
  // Only override if similarity-based match wasn't already confident
  if (windowSize === 1 && bestScore < 0.9) {
    const trimmedSearch = oldStr.trim();
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(trimmedSearch) || lines[i].trim() === trimmedSearch) {
        bestScore = 0.9;
        bestLineIdx = i;
        break;
      }
    }
  }

  const CONTEXT_LINES = 5;
  const startLine = Math.max(0, bestLineIdx - CONTEXT_LINES);
  const endLine = Math.min(lines.length, bestLineIdx + windowSize + CONTEXT_LINES);

  if (bestScore > 0.4) {
    const contextPreview = lines
      .slice(startLine, endLine)
      .map((line, idx) => {
        const lineNum = startLine + idx + 1;
        const marker =
          lineNum > bestLineIdx && lineNum <= bestLineIdx + windowSize ? ">>>" : "   ";
        return `${marker} ${String(lineNum).padStart(4)}: ${line}`;
      })
      .join("\n");

    return (
      `Error: old_string not found in ${path}.\n\n` +
      `Closest match (${Math.round(bestScore * 100)}% similar) near line ${bestLineIdx + 1}:\n` +
      `${contextPreview}\n\n` +
      `Check for whitespace/indentation differences, or re-read the file to get exact content.`
    );
  }

  // Low similarity — fall back to showing file structure
  const preview = lines.slice(0, 30).map((l, i) => `${String(i + 1).padStart(4)}: ${l}`).join("\n");
  return (
    `Error: old_string not found in ${path} (no close match found).\n\n` +
    `File has ${lines.length} lines. First 30:\n${preview}\n\n` +
    `Re-read the file with file_read to get the exact content before editing.`
  );
}
