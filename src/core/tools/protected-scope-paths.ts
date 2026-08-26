import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { escape as escapeGlob, globSync } from "glob";
import {
  isScopeAuthorityOperatorTokenPath,
  scopeAuthorityOperatorTokenPaths,
} from "#core/daemon/scope-authority-operator-token.js";
import type { ToolRunnerContext } from "#core/tools/index.js";
import {
  resolvePathFrom,
  resolvePathThroughExistingAncestor,
} from "#core/util/real-path.js";

export const PROTECTED_SCOPE_RUNTIME_FILES = [
  ".kota/daemon-control.json",
  ".kota/secrets.json",
] as const;

export const PROTECTED_SCOPE_ENV_GLOBS = [
  ".env",
  ".env.*",
  "**/.env",
  "**/.env.*",
] as const;

const PROTECTED_SCOPE_GLOB_IGNORES = [
  ...PROTECTED_SCOPE_RUNTIME_FILES.map((path) => `**/${path}`),
  ...PROTECTED_SCOPE_ENV_GLOBS,
] as const;

const PROTECTED_SCOPE_GREP_EXCLUDES = [
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

export function protectedScopeGlobIgnores(
  context?: Pick<ToolRunnerContext, "authorityConfigPath">,
): string[] {
  return [
    ...PROTECTED_SCOPE_GLOB_IGNORES,
    ...protectedOperatorTokenFileNames(context).map(
      (fileName) => `**/${escapeGlob(fileName)}`,
    ),
  ];
}

export function protectedScopeGrepExcludes(
  context?: Pick<ToolRunnerContext, "authorityConfigPath">,
): string[] {
  return [
    ...PROTECTED_SCOPE_GREP_EXCLUDES,
    ...protectedOperatorTokenFileNames(context).map((fileName) => escapeGlob(fileName)),
  ];
}

export function existingProtectedScopePaths(
  allowedRoot: string,
): string[] {
  const scopeRoot = resolve(allowedRoot);
  const scopePaths = globSync(
    [...PROTECTED_SCOPE_RUNTIME_FILES, ...PROTECTED_SCOPE_ENV_GLOBS],
    {
      cwd: scopeRoot,
      absolute: true,
      dot: true,
      nodir: true,
      follow: false,
      ignore: [".git/**", ".worktrees/**", "node_modules/**"],
    },
  );
  return [...new Set(scopePaths.map((path) => resolve(path)))];
}

function normalizeRelativeScopePath(relativePath: string): string {
  return relativePath.split(sep).join("/").toLowerCase();
}

function isProtectedEnvFile(normalizedRelativePath: string): boolean {
  const fileName = normalizedRelativePath.split("/").at(-1) ?? "";
  return fileName === ".env" || fileName.startsWith(".env.");
}

function isProtectedRuntimeFile(normalizedRelativePath: string): boolean {
  return PROTECTED_SCOPE_RUNTIME_FILES.some(
    (path) => normalizedRelativePath === path || normalizedRelativePath.endsWith(`/${path}`),
  );
}

export function isProtectedRelativeScopePath(relativePath: string): boolean {
  const normalizedRelativePath = normalizeRelativeScopePath(relativePath);
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

  return isProtectedRelativeScopePath(relativePath);
}

function isProtectedPathUnderBase(
  filePath: string,
  baseDirectory: string,
): boolean {
  const scopeRoot = resolve(baseDirectory);
  const requestedPath = resolvePathFrom(scopeRoot, filePath);
  const resolvedPath = resolvePathThroughExistingAncestor(requestedPath);
  const candidatePaths = resolvedPath
    ? [requestedPath, resolvedPath]
    : [requestedPath];
  const resolvedScopeRoot = resolvePathThroughExistingAncestor(scopeRoot);
  const candidateRoots = resolvedScopeRoot === null
    ? [scopeRoot]
    : [scopeRoot, resolvedScopeRoot];

  return candidatePaths.some((path) =>
    candidateRoots.some((root) => isProtectedResolvedPathUnderBase(path, root)),
  );
}

export function isProtectedScopePath(
  filePath: string,
  context?: Pick<ToolRunnerContext, "authorityConfigPath" | "cwd">,
): boolean {
  const baseDirectory = context?.cwd ?? process.cwd();
  if (isScopeAuthorityOperatorTokenPath(filePath, {
    baseDirectory,
    authorityConfigPath: context?.authorityConfigPath,
  })) return true;
  if (isProtectedPathUnderBase(filePath, baseDirectory)) return true;
  const daemonScopeRoot = process.cwd();
  return resolve(baseDirectory) !== resolve(daemonScopeRoot)
    && isProtectedPathUnderBase(filePath, daemonScopeRoot);
}

export function protectedScopePathError(filePath: string): string {
  return `Error: access denied for protected scope runtime credential file: ${filePath}`;
}

function isPathWithin(root: string, target: string): boolean {
  const child = relative(root, target);
  return child === "" || (!child.startsWith("..") && !isAbsolute(child));
}

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
