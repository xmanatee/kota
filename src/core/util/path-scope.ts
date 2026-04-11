import { isAbsolute, relative, resolve } from "node:path";

function isWithinRoot(dir: string, rootDir: string): boolean {
  const rel = relative(rootDir, dir);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function resolveScopedSearch(startDir?: string, rootDir?: string): {
  startDir: string;
  rootDir: string;
} {
  const resolvedStartDir = resolve(startDir ?? process.cwd());
  const resolvedRootDir = resolve(rootDir ?? resolvedStartDir);

  if (!isWithinRoot(resolvedStartDir, resolvedRootDir)) {
    throw new Error(
      `Scoped search startDir must be inside rootDir: ${resolvedStartDir} !<= ${resolvedRootDir}`,
    );
  }

  return {
    startDir: resolvedStartDir,
    rootDir: resolvedRootDir,
  };
}
