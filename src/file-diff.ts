/**
 * Simple line-based diff for display purposes.
 * Shows changed regions with context. Not a full unified diff — optimized for
 * token efficiency in agent context.
 */
export function simpleDiff(original: string, current: string, path: string): string {
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
