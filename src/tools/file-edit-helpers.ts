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

  const preview = lines.slice(0, 30).map((l, i) => `${String(i + 1).padStart(4)}: ${l}`).join("\n");
  return (
    `Error: old_string not found in ${path} (no close match found).\n\n` +
    `File has ${lines.length} lines. First 30:\n${preview}\n\n` +
    `Re-read the file with file_read to get the exact content before editing.`
  );
}
