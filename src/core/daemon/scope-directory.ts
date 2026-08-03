import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { projectHash } from "./schedule-parser.js";
import type {
  ConfiguredProject,
  ConfiguredProjectInput,
  ProjectId,
} from "./scope-registry.js";

export type DirectoryScopeResolution =
  | { ok: true; project: ConfiguredProject }
  | {
      ok: false;
      reason:
        | "invalid_directory"
        | "directory_not_found"
        | "directory_inaccessible"
        | "not_directory";
      projectDir: string;
      message: string;
    };

export function resolveDirectoryScopeRoot(projectDir: string): string {
  if (!projectDir.trim()) {
    throw new Error("projectDir must be a non-empty string");
  }
  return resolve(projectDir);
}

export function deriveDirectoryScopeId(projectDir: string): ProjectId {
  const resolved = resolveLiveDirectoryScope({ projectDir });
  if (!resolved.ok) throw new Error(resolved.message);
  return resolved.project.projectId;
}

export function buildConfiguredProject(
  input: ConfiguredProjectInput,
): ConfiguredProject {
  const resolved = resolveLiveDirectoryScope(input);
  if (!resolved.ok) throw new Error(resolved.message);
  return resolved.project;
}

export function resolveLiveDirectoryScope(
  input: ConfiguredProjectInput,
): DirectoryScopeResolution {
  let resolved: string;
  try {
    resolved = resolveDirectoryScopeRoot(input.projectDir);
  } catch (error) {
    return {
      ok: false,
      reason: "invalid_directory",
      projectDir: input.projectDir,
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
      projectDir: resolved,
      message: `${resolved}: ${reason.replaceAll("_", " ")}`,
    };
  }

  try {
    if (!statSync(canonical).isDirectory()) {
      return {
        ok: false,
        reason: "not_directory",
        projectDir: canonical,
        message: `${canonical}: scope root must be a directory`,
      };
    }
    accessSync(canonical, constants.R_OK | constants.X_OK);
  } catch (error) {
    return {
      ok: false,
      reason: "directory_inaccessible",
      projectDir: canonical,
      message: `${canonical}: directory is not readable and searchable (${errorCode(error as NodeJS.ErrnoException) ?? "unknown"})`,
    };
  }

  return {
    ok: true,
    project: configuredProjectFromCanonicalDirectory(
      canonical,
      input.displayName,
    ),
  };
}

function configuredProjectFromCanonicalDirectory(
  projectDir: string,
  displayNameInput: string | undefined,
): ConfiguredProject {
  const displayName = (displayNameInput ?? "").trim() || basename(projectDir);
  return {
    projectId: projectHash(projectDir),
    projectDir,
    displayName,
  };
}

function errorCode(error: object | null): string | undefined {
  if (error === null || !("code" in error)) return undefined;
  return typeof error.code === "string" ? error.code : undefined;
}
