import { isAbsolute, relative, resolve, sep } from "node:path";
import { resolveProjectPath } from "#core/tools/project-path-policy.js";

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

export function isProtectedProjectPath(
  filePath: string,
  baseDirectory = process.cwd(),
): boolean {
  const resolved = resolveProjectPath(filePath, baseDirectory);
  if (!resolved.ok) return false;

  const relativePath = relative(resolve(process.cwd()), resolved.path);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return false;
  }

  return isProtectedRelativeProjectPath(relativePath);
}

export function protectedProjectPathError(filePath: string): string {
  return `Error: access denied for protected project runtime credential file: ${filePath}`;
}
