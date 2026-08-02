import { isAbsolute, relative, resolve } from "node:path";
import {
  resolvePathFrom,
  resolvePathThroughExistingAncestor,
} from "#core/util/real-path.js";

export { resolvePathFrom } from "#core/util/real-path.js";

function isPathInsideProject(resolvedPath: string, projectDirectory: string): boolean {
  const projectRoot = resolvePathThroughExistingAncestor(resolve(projectDirectory));
  if (projectRoot === null) return false;
  const relativePath = relative(projectRoot, resolvedPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export type ProjectPathResolution =
  | { ok: true; path: string }
  | { ok: false };

export function resolveProjectPath(
  filePath: string,
  baseDirectory = process.cwd(),
  projectDirectory = process.cwd(),
): ProjectPathResolution {
  const resolvedPath = resolvePathThroughExistingAncestor(
    resolvePathFrom(baseDirectory, filePath),
  );
  if (!resolvedPath) return { ok: false };
  if (!isPathInsideProject(resolvedPath, projectDirectory)) return { ok: false };
  return { ok: true, path: resolvedPath };
}

export function isOutsideProject(
  filePath: string,
  baseDirectory = process.cwd(),
  projectDirectory = process.cwd(),
): boolean {
  return !resolveProjectPath(filePath, baseDirectory, projectDirectory).ok;
}
