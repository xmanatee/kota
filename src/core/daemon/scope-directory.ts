import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { scopeHash } from "./schedule-parser.js";
import type {
  DirectoryScope,
  DirectoryScopeInput,
  ScopeId,
} from "./scope-registry.js";

export type DirectoryScopeResolution =
  | { ok: true; scope: DirectoryScope }
  | {
      ok: false;
      reason:
        | "invalid_directory"
        | "directory_not_found"
        | "directory_inaccessible"
        | "not_directory";
      scopeRoot: string;
      message: string;
    };

export function resolveDirectoryScopeRoot(scopeRoot: string): string {
  if (!scopeRoot.trim()) {
    throw new Error("scopeRoot must be a non-empty string");
  }
  return resolve(scopeRoot);
}

export function deriveDirectoryScopeId(scopeRoot: string): ScopeId {
  const resolved = resolveLiveDirectoryScope({ scopeRoot });
  if (!resolved.ok) throw new Error(resolved.message);
  return resolved.scope.scopeId;
}

export function buildDirectoryScope(
  input: DirectoryScopeInput,
): DirectoryScope {
  const resolved = resolveLiveDirectoryScope(input);
  if (!resolved.ok) throw new Error(resolved.message);
  return resolved.scope;
}

export function resolveLiveDirectoryScope(
  input: DirectoryScopeInput,
): DirectoryScopeResolution {
  let resolved: string;
  try {
    resolved = resolveDirectoryScopeRoot(input.scopeRoot);
  } catch (error) {
    return {
      ok: false,
      reason: "invalid_directory",
      scopeRoot: input.scopeRoot,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  let canonical: string;
  try {
    canonical = realpathSync.native(resolved);
  } catch (error) {
    const code = errorCode(error as NodeJS.ErrnoException);
    const reason =
      code === "ENOENT" || code === "ENOTDIR"
        ? "directory_not_found"
        : "directory_inaccessible";
    return {
      ok: false,
      reason,
      scopeRoot: resolved,
      message: `${resolved}: ${reason.replaceAll("_", " ")}`,
    };
  }

  try {
    if (!statSync(canonical).isDirectory()) {
      return {
        ok: false,
        reason: "not_directory",
        scopeRoot: canonical,
        message: `${canonical}: scope root must be a directory`,
      };
    }
    accessSync(canonical, constants.R_OK | constants.X_OK);
  } catch (error) {
    return {
      ok: false,
      reason: "directory_inaccessible",
      scopeRoot: canonical,
      message: `${canonical}: directory is not readable and searchable (${errorCode(error as NodeJS.ErrnoException) ?? "unknown"})`,
    };
  }

  return {
    ok: true,
    scope: configuredScopeFromCanonicalDirectory(
      canonical,
      input.displayName,
    ),
  };
}

function configuredScopeFromCanonicalDirectory(
  scopeRoot: string,
  displayNameInput: string | undefined,
): DirectoryScope {
  const displayName = (displayNameInput ?? "").trim() || basename(scopeRoot);
  return {
    scopeId: scopeHash(scopeRoot),
    scopeRoot,
    displayName,
  };
}

function errorCode(error: object | null): string | undefined {
  if (error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}
