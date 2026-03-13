import { statSync } from "node:fs";

/**
 * Tracks file modification times to detect stale reads.
 * When a file is modified externally (e.g., by a shell command) between
 * a file_read and a file_edit, the agent is warned before editing.
 */

const knownMtimes = new Map<string, number>();

function getMtime(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

/** Record that a file was read or written at its current mtime. */
export function recordRead(path: string): void {
  const mtime = getMtime(path);
  if (mtime !== null) {
    knownMtimes.set(path, mtime);
  }
}

/** Record that we modified a file (updates tracked mtime to current). */
export function recordModification(path: string): void {
  const mtime = getMtime(path);
  if (mtime !== null) {
    knownMtimes.set(path, mtime);
  }
}

/**
 * Check if a file was modified since we last read/wrote it.
 * Returns a warning string if stale, null if fresh or untracked.
 */
export function checkFreshness(path: string): string | null {
  const lastKnown = knownMtimes.get(path);
  if (lastKnown === undefined) return null;

  const current = getMtime(path);
  if (current === null) return null;

  if (current !== lastKnown) {
    knownMtimes.set(path, current);
    return (
      `Warning: ${path} was modified since you last read it. ` +
      "The content may have changed. Consider re-reading with file_read before editing."
    );
  }
  return null;
}
