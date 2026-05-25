import { existsSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

export function resolvePathFrom(baseDirectory: string, targetPath: string): string {
  return isAbsolute(targetPath)
    ? resolve(targetPath)
    : resolve(baseDirectory, targetPath);
}

function resolveBoundaryPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

const MAX_SYMLINK_RESOLUTION_DEPTH = 40;

function readSymlinkTarget(path: string): string | null {
  try {
    const stats = lstatSync(path);
    if (!stats.isSymbolicLink()) return null;
    return resolvePathFrom(dirname(path), readlinkSync(path));
  } catch {
    return null;
  }
}

function resolveThroughExistingAncestor(
  path: string,
  symlinkDepth = 0,
): string | null {
  if (symlinkDepth > MAX_SYMLINK_RESOLUTION_DEPTH) return null;

  let current = path;
  const missingSegments: string[] = [];

  while (true) {
    const symlinkTarget = readSymlinkTarget(current);
    if (symlinkTarget) {
      return resolveThroughExistingAncestor(
        join(symlinkTarget, ...missingSegments),
        symlinkDepth + 1,
      );
    }

    if (existsSync(current)) {
      return join(resolveBoundaryPath(current), ...missingSegments);
    }

    const parent = dirname(current);
    if (parent === current) {
      return join(resolveBoundaryPath(current), ...missingSegments);
    }
    missingSegments.unshift(basename(current));
    current = parent;
  }
}

function isPathInsideProject(resolvedPath: string): boolean {
  const projectRoot = resolveBoundaryPath(resolve(process.cwd()));
  const relativePath = relative(projectRoot, resolvedPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export type ProjectPathResolution =
  | { ok: true; path: string }
  | { ok: false };

export function resolveProjectPath(
  filePath: string,
  baseDirectory = process.cwd(),
): ProjectPathResolution {
  const resolvedPath = resolveThroughExistingAncestor(resolvePathFrom(baseDirectory, filePath));
  if (!resolvedPath) return { ok: false };
  if (!isPathInsideProject(resolvedPath)) return { ok: false };
  return { ok: true, path: resolvedPath };
}

export function isOutsideProject(
  filePath: string,
  baseDirectory = process.cwd(),
): boolean {
  return !resolveProjectPath(filePath, baseDirectory).ok;
}
