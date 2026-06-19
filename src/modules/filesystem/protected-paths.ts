import { existsSync, lstatSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const PROTECTED_PROJECT_RUNTIME_FILES = [
  ".kota/daemon-control.json",
  ".kota/secrets.json",
] as const;

export const PROTECTED_PROJECT_GLOB_IGNORES = [
  "**/.kota/daemon-control.json",
  "**/.kota/secrets.json",
  "**/.env",
  "**/.env.*",
] as const;

export const PROTECTED_PROJECT_GREP_EXCLUDES = [
  "daemon-control.json",
  "secrets.json",
  ".env",
  ".env.*",
] as const;

function normalizeRelativeProjectPath(relativePath: string): string {
  return relativePath.split(sep).join("/").toLowerCase();
}

function isProtectedEnvFile(normalizedRelativePath: string): boolean {
  const fileName = normalizedRelativePath.split("/").at(-1) ?? "";
  return fileName === ".env" || fileName.startsWith(".env.");
}

function isProtectedRuntimeFile(normalizedRelativePath: string): boolean {
  return PROTECTED_PROJECT_RUNTIME_FILES.some(
    (path) => normalizedRelativePath === path || normalizedRelativePath.endsWith(`/${path}`),
  );
}

export function isProtectedRelativeProjectPath(relativePath: string): boolean {
  const normalizedRelativePath = normalizeRelativeProjectPath(relativePath);
  return isProtectedRuntimeFile(normalizedRelativePath) || isProtectedEnvFile(normalizedRelativePath);
}

function resolvePathFrom(baseDirectory: string, targetPath: string): string {
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

function isProtectedResolvedPathUnderBase(
  resolvedPath: string,
  baseDirectory: string,
): boolean {
  const relativePath = relative(baseDirectory, resolvedPath);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return false;
  }

  return isProtectedRelativeProjectPath(relativePath);
}

function isProtectedPathUnderBase(
  filePath: string,
  baseDirectory: string,
): boolean {
  const projectRoot = resolve(baseDirectory);
  const requestedPath = resolvePathFrom(projectRoot, filePath);
  const resolvedPath = resolveThroughExistingAncestor(requestedPath);
  const candidatePaths = resolvedPath
    ? [requestedPath, resolvedPath]
    : [requestedPath];
  const candidateRoots = [projectRoot, resolveBoundaryPath(projectRoot)];

  return candidatePaths.some((path) =>
    candidateRoots.some((root) => isProtectedResolvedPathUnderBase(path, root)),
  );
}

export function isProtectedProjectPath(
  filePath: string,
  baseDirectory = process.cwd(),
): boolean {
  if (isProtectedPathUnderBase(filePath, baseDirectory)) return true;
  const daemonProjectRoot = process.cwd();
  return resolve(baseDirectory) !== resolve(daemonProjectRoot)
    && isProtectedPathUnderBase(filePath, daemonProjectRoot);
}

export function protectedProjectPathError(filePath: string): string {
  return `Error: access denied for protected project runtime credential file: ${filePath}`;
}
