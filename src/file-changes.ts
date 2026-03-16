import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";

/**
 * Tracks file modifications during an agent session and provides undo capability.
 *
 * Records the original content of each file before the first modification.
 * Subsequent modifications to the same file update only the change count — the
 * original state is preserved so the file can be fully restored.
 *
 * Singleton: initChangeTracker() / getChangeTracker() / resetChangeTracker().
 */

type TrackedFile = {
  originalContent: string | null; // null = file didn't exist before first change
  changeCount: number;
  firstChangedAt: number;
  lastChangedAt: number;
  lastTool: string;
};

let instance: ChangeTracker | null = null;

export class ChangeTracker {
  private tracked = new Map<string, TrackedFile>();

  /**
   * Record that a file is about to be modified.
   * Call BEFORE writing the new content. Only the first call per path
   * saves the original content — subsequent calls just bump the counter.
   */
  recordChange(path: string, beforeContent: string | null, tool: string): void {
    const existing = this.tracked.get(path);
    if (existing) {
      existing.changeCount++;
      existing.lastChangedAt = Date.now();
      existing.lastTool = tool;
    } else {
      this.tracked.set(path, {
        originalContent: beforeContent,
        changeCount: 1,
        firstChangedAt: Date.now(),
        lastChangedAt: Date.now(),
        lastTool: tool,
      });
    }
  }

  /** List all tracked files with their change metadata. */
  getTrackedFiles(): Array<{
    path: string;
    changeCount: number;
    isNew: boolean;
    lastTool: string;
  }> {
    return [...this.tracked.entries()].map(([path, t]) => ({
      path,
      changeCount: t.changeCount,
      isNew: t.originalContent === null,
      lastTool: t.lastTool,
    }));
  }

  /** Number of tracked files. */
  get fileCount(): number {
    return this.tracked.size;
  }

  /** Total number of changes across all files. */
  get totalChanges(): number {
    let total = 0;
    for (const t of this.tracked.values()) total += t.changeCount;
    return total;
  }

  /** Check if a file is being tracked. */
  isTracked(path: string): boolean {
    return this.tracked.has(path);
  }

  /**
   * Generate a unified diff-style summary of changes to a file.
   * Compares original content with current file on disk.
   */
  diff(path: string): { content: string; error?: string } {
    const entry = this.tracked.get(path);
    if (!entry) return { content: "", error: `File not tracked: ${path}` };

    if (entry.originalContent === null) {
      // File was newly created
      if (!existsSync(path)) {
        return { content: "[New file — since deleted]" };
      }
      const current = readFileSync(path, "utf-8");
      const lines = current.split("\n");
      return {
        content:
          `[New file: ${path}] (${lines.length} lines)\n` +
          lines.map((l) => `+ ${l}`).join("\n"),
      };
    }

    if (!existsSync(path)) {
      return {
        content:
          `[Deleted: ${path}] (was ${entry.originalContent.split("\n").length} lines)\n` +
          entry.originalContent
            .split("\n")
            .map((l) => `- ${l}`)
            .join("\n"),
      };
    }

    const current = readFileSync(path, "utf-8");
    if (current === entry.originalContent) {
      return { content: `[No net changes to ${path}]` };
    }

    return { content: simpleDiff(entry.originalContent, current, path) };
  }

  /**
   * Restore a specific file to its original state.
   * Returns success/error information.
   */
  restore(path: string): { success: boolean; error?: string } {
    const entry = this.tracked.get(path);
    if (!entry) return { success: false, error: `File not tracked: ${path}` };

    try {
      if (entry.originalContent === null) {
        // File was created during session — remove it
        if (existsSync(path)) unlinkSync(path);
      } else {
        writeFileSync(path, entry.originalContent, "utf-8");
      }
      this.tracked.delete(path);
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  }

  /** Restore all tracked files to their original state. */
  restoreAll(): { restored: string[]; errors: Array<{ path: string; error: string }> } {
    const restored: string[] = [];
    const errors: Array<{ path: string; error: string }> = [];

    for (const path of [...this.tracked.keys()]) {
      const result = this.restore(path);
      if (result.success) {
        restored.push(path);
      } else {
        errors.push({ path, error: result.error || "Unknown error" });
      }
    }

    return { restored, errors };
  }

  /** Summary string for injection into dynamic system state. Empty if nothing tracked. */
  getSummary(): string {
    if (this.tracked.size === 0) return "";
    const files = this.getTrackedFiles();
    const names = files
      .slice(-8)
      .map((f) => f.path)
      .join(", ");
    const extra = files.length > 8 ? ` (${files.length} total)` : "";
    return `\n[${this.totalChanges} file change(s) tracked across ${files.length} file(s)${extra}: ${names} — use checkpoint tool to review/undo]`;
  }

  /** Clear all tracking state. */
  clear(): void {
    this.tracked.clear();
  }
}

/** Initialize the global ChangeTracker. */
export function initChangeTracker(): ChangeTracker {
  instance = new ChangeTracker();
  return instance;
}

/** Get the global ChangeTracker, or null if not initialized. */
export function getChangeTracker(): ChangeTracker | null {
  return instance;
}

/** Reset (clear and nullify) the global ChangeTracker. */
export function resetChangeTracker(): void {
  if (instance) instance.clear();
  instance = null;
}

/**
 * Convenience: record a file change on the global tracker (no-op if not initialized).
 * Call from file tool runners after a successful write.
 */
export function trackFileChange(path: string, beforeContent: string | null, tool: string): void {
  instance?.recordChange(path, beforeContent, tool);
}

/**
 * Simple line-based diff for display purposes.
 * Shows changed regions with context. Not a full unified diff — optimized for
 * token efficiency in agent context.
 */
function simpleDiff(original: string, current: string, path: string): string {
  const oldLines = original.split("\n");
  const newLines = current.split("\n");

  const parts: string[] = [`[Changes to ${path}]`];

  // Find changed regions
  const maxLen = Math.max(oldLines.length, newLines.length);
  let i = 0;
  let regionCount = 0;
  const MAX_REGIONS = 10;

  while (i < maxLen && regionCount < MAX_REGIONS) {
    if (i < oldLines.length && i < newLines.length && oldLines[i] === newLines[i]) {
      i++;
      continue;
    }

    // Found a difference — find the extent
    const regionStart = i;
    let oldEnd = i;
    let newEnd = i;

    // Scan forward to find where lines match again
    while (oldEnd < oldLines.length || newEnd < newLines.length) {
      if (oldEnd < oldLines.length && newEnd < newLines.length && oldLines[oldEnd] === newLines[newEnd]) {
        // Check if this is a real resync (3+ matching lines)
        let matchLen = 0;
        while (
          oldEnd + matchLen < oldLines.length &&
          newEnd + matchLen < newLines.length &&
          oldLines[oldEnd + matchLen] === newLines[newEnd + matchLen]
        ) {
          matchLen++;
          if (matchLen >= 3) break;
        }
        if (matchLen >= 3) break;
      }
      if (oldEnd < oldLines.length) oldEnd++;
      if (newEnd < newLines.length) newEnd++;
    }

    parts.push(`@@ line ${regionStart + 1} @@`);
    for (let j = regionStart; j < oldEnd; j++) {
      parts.push(`- ${oldLines[j]}`);
    }
    for (let j = regionStart; j < newEnd; j++) {
      parts.push(`+ ${newLines[j]}`);
    }

    i = Math.max(oldEnd, newEnd);
    regionCount++;
  }

  if (regionCount >= MAX_REGIONS) {
    parts.push(`... (${maxLen - i} more lines differ)`);
  }

  if (oldLines.length !== newLines.length) {
    parts.push(`[${oldLines.length} → ${newLines.length} lines]`);
  }

  return parts.join("\n");
}
