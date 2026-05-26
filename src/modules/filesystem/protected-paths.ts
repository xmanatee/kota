import { isAbsolute, relative, resolve, sep } from "node:path";
import { resolveProjectPath } from "#core/tools/project-path-policy.js";

const PROTECTED_PROJECT_FILES = new Set([".kota/daemon-control.json"]);

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

  return PROTECTED_PROJECT_FILES.has(relativePath.split(sep).join("/").toLowerCase());
}

export function protectedProjectPathError(filePath: string): string {
  return `Error: access denied for protected project runtime credential file: ${filePath}`;
}
