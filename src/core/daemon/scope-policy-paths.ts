import { isAbsolute, relative, resolve } from "node:path";

export function resolveScopePolicyPath(path: string, directoryRoot: string | undefined): string | null {
  if (isAbsolute(path)) {
    return resolve(path);
  }
  if (directoryRoot === undefined) {
    return null;
  }
  return resolve(directoryRoot, path);
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
  const normalizedRoot = resolve(root);
  const normalizedTarget = resolve(target);
  const child = relative(normalizedRoot, normalizedTarget);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}
