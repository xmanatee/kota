import { isAbsolute, relative, resolve } from "node:path";
import { resolvePathThroughExistingAncestor } from "#core/util/real-path.js";

export function resolveScopePolicyPath(path: string, directoryRoot: string | undefined): string | null {
  if (isAbsolute(path)) {
    return resolvePathThroughExistingAncestor(resolve(path));
  }
  if (directoryRoot === undefined) {
    return null;
  }
  return resolvePathThroughExistingAncestor(resolve(directoryRoot, path));
}

export function resolveScopePolicyPaths(
  paths: readonly string[],
  directoryRoot: string | undefined,
): string[] {
  return paths
    .map((path) => resolveScopePolicyPath(path, directoryRoot))
    .filter((path): path is string => path !== null);
}

export function isScopePolicyPathWithin(root: string, target: string): boolean {
  const normalizedRoot = resolvePathThroughExistingAncestor(resolve(root));
  const normalizedTarget = resolvePathThroughExistingAncestor(resolve(target));
  if (normalizedRoot === null || normalizedTarget === null) return false;
  const child = relative(normalizedRoot, normalizedTarget);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}
