import { existsSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const MAX_SYMLINK_RESOLUTION_DEPTH = 40;

export function resolvePathFrom(baseDirectory: string, targetPath: string): string {
  return isAbsolute(targetPath)
    ? resolve(targetPath)
    : resolve(baseDirectory, targetPath);
}

function readSymlinkTarget(path: string): string | null {
  try {
    const stats = lstatSync(path);
    if (!stats.isSymbolicLink()) return null;
    return resolvePathFrom(dirname(path), readlinkSync(path));
  } catch {
    return null;
  }
}

/**
 * Resolve every existing path component, including symlinks, while preserving
 * a missing suffix. This lets authorization bind a future create to the real
 * directory that will receive it instead of to a lexical alias.
 */
export function resolvePathThroughExistingAncestor(
  path: string,
  symlinkDepth = 0,
): string | null {
  if (symlinkDepth > MAX_SYMLINK_RESOLUTION_DEPTH) return null;

  let current = resolve(path);
  const missingSegments: string[] = [];

  while (true) {
    const symlinkTarget = readSymlinkTarget(current);
    if (symlinkTarget !== null) {
      return resolvePathThroughExistingAncestor(
        join(symlinkTarget, ...missingSegments),
        symlinkDepth + 1,
      );
    }

    if (existsSync(current)) {
      try {
        return join(realpathSync.native(current), ...missingSegments);
      } catch {
        return null;
      }
    }

    const parent = dirname(current);
    if (parent === current) return null;
    missingSegments.unshift(basename(current));
    current = parent;
  }
}
