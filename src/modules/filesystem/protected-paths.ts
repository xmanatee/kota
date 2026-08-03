import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { escape as escapeGlob } from "glob";
import {
  isScopeAuthorityOperatorTokenPath,
  scopeAuthorityOperatorTokenPaths,
} from "#core/daemon/scope-authority-operator-token.js";
import type { ToolRunnerContext } from "#core/tools/index.js";
import {
  resolvePathFrom,
  resolvePathThroughExistingAncestor,
} from "#core/util/real-path.js";

const PROTECTED_PROJECT_RUNTIME_FILES = [
  ".kota/daemon-control.json",
  ".kota/secrets.json",
] as const;

const PROTECTED_PROJECT_GLOB_IGNORES = [
  "**/.kota/daemon-control.json",
  "**/.kota/secrets.json",
  "**/.env",
  "**/.env.*",
] as const;

const PROTECTED_PROJECT_GREP_EXCLUDES = [
  "daemon-control.json",
  "secrets.json",
  ".env",
  ".env.*",
] as const;

function protectedOperatorTokenFileNames(
  context?: Pick<ToolRunnerContext, "authorityConfigPath">,
): string[] {
  return [...new Set(
    scopeAuthorityOperatorTokenPaths(context?.authorityConfigPath).map((path) => basename(path)),
  )];
}

export function protectedProjectGlobIgnores(
  context?: Pick<ToolRunnerContext, "authorityConfigPath">,
): string[] {
  return [
    ...PROTECTED_PROJECT_GLOB_IGNORES,
    ...protectedOperatorTokenFileNames(context).map(
      (fileName) => `**/${escapeGlob(fileName)}`,
    ),
  ];
}

export function protectedProjectGrepExcludes(
  context?: Pick<ToolRunnerContext, "authorityConfigPath">,
): string[] {
  return [
    ...PROTECTED_PROJECT_GREP_EXCLUDES,
    ...protectedOperatorTokenFileNames(context).map((fileName) => escapeGlob(fileName)),
  ];
}

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
  const resolvedPath = resolvePathThroughExistingAncestor(requestedPath);
  const candidatePaths = resolvedPath
    ? [requestedPath, resolvedPath]
    : [requestedPath];
  const resolvedProjectRoot = resolvePathThroughExistingAncestor(projectRoot);
  const candidateRoots = resolvedProjectRoot === null
    ? [projectRoot]
    : [projectRoot, resolvedProjectRoot];

  return candidatePaths.some((path) =>
    candidateRoots.some((root) => isProtectedResolvedPathUnderBase(path, root)),
  );
}

export function isProtectedProjectPath(
  filePath: string,
  context?: Pick<ToolRunnerContext, "authorityConfigPath" | "cwd">,
): boolean {
  const baseDirectory = context?.cwd ?? process.cwd();
  if (isScopeAuthorityOperatorTokenPath(filePath, {
    baseDirectory,
    authorityConfigPath: context?.authorityConfigPath,
  })) return true;
  if (isProtectedPathUnderBase(filePath, baseDirectory)) return true;
  const daemonProjectRoot = process.cwd();
  return resolve(baseDirectory) !== resolve(daemonProjectRoot)
    && isProtectedPathUnderBase(filePath, daemonProjectRoot);
}

export function protectedProjectPathError(filePath: string): string {
  return `Error: access denied for protected project runtime credential file: ${filePath}`;
}

function isPathWithin(root: string, target: string): boolean {
  const child = relative(root, target);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

/**
 * Agent filesystem tools must never become a second writer for machine-owned
 * authority. Protect the whole containing directory to match the execution
 * sandbox, which also covers the operator credential beside the config file.
 */
export function isMachineAuthorityMutationPath(
  filePath: string,
  context?: Pick<ToolRunnerContext, "authorityConfigPath" | "cwd">,
): boolean {
  if (context?.authorityConfigPath === undefined) return false;

  const requestedPath = resolvePathFrom(context.cwd ?? process.cwd(), filePath);
  const authorityDirectory = dirname(resolve(context.authorityConfigPath));
  const resolvedRequestedPath = resolvePathThroughExistingAncestor(requestedPath);
  const resolvedAuthorityDirectory = resolvePathThroughExistingAncestor(authorityDirectory);
  const candidatePaths = resolvedRequestedPath === null
    ? [requestedPath]
    : [requestedPath, resolvedRequestedPath];
  const candidateRoots = resolvedAuthorityDirectory === null
    ? [authorityDirectory]
    : [authorityDirectory, resolvedAuthorityDirectory];

  return candidatePaths.some((path) =>
    candidateRoots.some((root) => isPathWithin(root, path)),
  );
}

export function machineAuthorityMutationError(): string {
  return "Error: operator-owned machine authority cannot be changed by agent filesystem tools; use the authenticated scope authority service";
}
