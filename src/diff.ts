/**
 * Minimal diff display for file edits.
 * Prints colored unified-diff-style output to stderr so the user
 * can see what the agent changed without reading the tool result.
 */

const CONTEXT_LINES = 2;
const MAX_DIFF_LINES = 40;

function color(isTTY: boolean) {
  if (!isTTY) return { red: "", green: "", cyan: "", dim: "", reset: "" };
  return {
    red: "\x1b[31m",
    green: "\x1b[32m",
    cyan: "\x1b[36m",
    dim: "\x1b[2m",
    reset: "\x1b[0m",
  };
}

/** Find the 1-based line number where `substring` first appears in `content`. */
export function findLineNumber(content: string, substring: string): number {
  const idx = content.indexOf(substring);
  if (idx === -1) return 1;
  return content.slice(0, idx).split("\n").length;
}

/**
 * Print a compact unified diff to stderr for a file_edit operation.
 * Shows context lines around the change, colored if stderr is a TTY.
 */
export function printEditDiff(
  path: string,
  content: string,
  oldStr: string,
  newStr: string,
): void {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");

  // For large diffs, show a one-line summary instead of flooding the terminal
  if (oldLines.length + newLines.length > MAX_DIFF_LINES) {
    const lineNum = findLineNumber(content, oldStr);
    const c = color(process.stderr.isTTY ?? false);
    process.stderr.write(
      `${c.dim}${path}:${lineNum} — replaced ${oldLines.length} lines with ${newLines.length} lines${c.reset}\n`,
    );
    return;
  }

  const isTTY = process.stderr.isTTY ?? false;
  const c = color(isTTY);
  const lines = content.split("\n");
  const lineNum = findLineNumber(content, oldStr);

  const ctxStart = Math.max(0, lineNum - 1 - CONTEXT_LINES);
  const ctxEnd = Math.min(lines.length, lineNum - 1 + oldLines.length + CONTEXT_LINES);

  const contextBefore = lines.slice(ctxStart, lineNum - 1);
  const contextAfter = lines.slice(lineNum - 1 + oldLines.length, ctxEnd);

  const parts: string[] = [];
  parts.push(`${c.dim}--- a/${path}`);
  parts.push(`+++ b/${path}${c.reset}`);
  parts.push(
    `${c.cyan}@@ -${lineNum},${oldLines.length} +${lineNum},${newLines.length} @@${c.reset}`,
  );
  for (const l of contextBefore) parts.push(` ${l}`);
  for (const l of oldLines) parts.push(`${c.red}-${l}${c.reset}`);
  for (const l of newLines) parts.push(`${c.green}+${l}${c.reset}`);
  for (const l of contextAfter) parts.push(` ${l}`);

  process.stderr.write(parts.join("\n") + "\n");
}

/**
 * Print a one-line summary for file_write overwrites.
 */
export function printWriteSummary(
  path: string,
  oldLineCount: number,
  newLineCount: number,
): void {
  const c = color(process.stderr.isTTY ?? false);
  process.stderr.write(
    `${c.dim}${path}: ${oldLineCount} → ${newLineCount} lines${c.reset}\n`,
  );
}
