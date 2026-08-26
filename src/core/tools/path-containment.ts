import { isAbsolute, relative, resolve } from "node:path";
import {
  resolvePathFrom,
  resolvePathThroughExistingAncestor,
} from "#core/util/real-path.js";

export { resolvePathFrom } from "#core/util/real-path.js";

function isPathInsideRoot(resolvedPath: string, allowedRoot: string): boolean {
  const resolvedRoot = resolvePathThroughExistingAncestor(resolve(allowedRoot));
  if (resolvedRoot === null) return false;
  const relativePath = relative(resolvedRoot, resolvedPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export type ContainedPathResolution =
  | { ok: true; path: string }
  | { ok: false };

export function resolveContainedPath(
  filePath: string,
  baseDirectory = process.cwd(),
  allowedRoot = process.cwd(),
): ContainedPathResolution {
  const resolvedPath = resolvePathThroughExistingAncestor(
    resolvePathFrom(baseDirectory, filePath),
  );
  if (!resolvedPath) return { ok: false };
  if (!isPathInsideRoot(resolvedPath, allowedRoot)) return { ok: false };
  return { ok: true, path: resolvedPath };
}

export function isPathOutsideRoot(
  filePath: string,
  baseDirectory = process.cwd(),
  allowedRoot = process.cwd(),
): boolean {
  return !resolveContainedPath(filePath, baseDirectory, allowedRoot).ok;
}
