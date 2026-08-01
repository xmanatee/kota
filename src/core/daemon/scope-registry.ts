/**
 * Persisted directory-scope identity and registry state.
 *
 * The first daemon boot seeds this registry from configuration. Once the
 * registry file exists it is the runtime authority: later config input does
 * not erase live registrations, display names, or the selected default.
 */

import { join } from "node:path";
import type { ProjectId } from "#core/events/project-scope.js";
import {
  JsonFileError,
  readOptionalJsonFile,
} from "#core/util/json-file.js";

export type { DirectoryScopeResolution } from "./scope-directory.js";
export { buildConfiguredProject, deriveDirectoryScopeId } from "./scope-directory.js";
export {
  GLOBAL_SCOPE_ID,
  resolveConfiguredProjects,
  scopeProjectionFromProjects,
} from "./scope-registry-projection.js";

export type ScopeId = ProjectId;
export type { ProjectId };

export type ConfiguredProjectInput = {
  projectDir: string;
  displayName?: string;
};

export type ConfiguredProject = {
  readonly projectId: ProjectId;
  readonly projectDir: string;
  readonly displayName: string;
};

export type ConfiguredScope = {
  readonly scopeId: ScopeId;
  readonly displayName: string;
  readonly parentScopeId?: ScopeId;
  readonly directoryRoot?: string;
};

export type ScopeRegistryProjection = {
  readonly rootScopeId: ScopeId;
  readonly defaultScopeId: ScopeId;
  readonly scopes: ConfiguredScope[];
};

export type ProjectRegistryProjection = {
  defaultProjectId: ProjectId;
  projects: ConfiguredProject[];
};

export const PROJECT_REGISTRY_SCHEMA_VERSION = 1;
const REGISTRY_FILE = "project-registry.json";

export type ProjectRegistryFile = {
  schema: typeof PROJECT_REGISTRY_SCHEMA_VERSION;
  defaultProjectId: ProjectId;
  projects: ConfiguredProject[];
};

export type ScopeRegistryInit = {
  stateDir: string;
  projects: readonly ConfiguredProjectInput[];
};

export { ScopeRegistry } from "./scope-registry-state.js";

export function loadRegistryFileFromDisk(
  stateDir: string,
): ProjectRegistryFile | null {
  const path = scopeRegistryPath(stateDir);
  const raw = readOptionalJsonFile<unknown>(path);
  return raw === null ? null : assertRegistryFile(path, raw);
}

export function scopeRegistryPath(stateDir: string): string {
  return join(stateDir, REGISTRY_FILE);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertConfiguredProject(
  path: string,
  index: number,
  raw: unknown,
): ConfiguredProject {
  if (!isPlainObject(raw)) {
    throw new JsonFileError(path, "parse", `projects[${index}] is not an object`);
  }
  const { projectId, projectDir, displayName } = raw;
  if (typeof projectId !== "string" || !projectId.trim()) {
    throw new JsonFileError(path, "parse", `projects[${index}].projectId must be a non-empty string`);
  }
  if (typeof projectDir !== "string" || !projectDir.trim()) {
    throw new JsonFileError(path, "parse", `projects[${index}].projectDir must be a non-empty string`);
  }
  if (typeof displayName !== "string" || !displayName.trim()) {
    throw new JsonFileError(path, "parse", `projects[${index}].displayName must be a non-empty string`);
  }
  return { projectId, projectDir, displayName };
}

function assertRegistryFile(path: string, raw: unknown): ProjectRegistryFile {
  if (!isPlainObject(raw)) {
    throw new JsonFileError(path, "parse", "registry file is not an object");
  }
  if (raw.schema !== PROJECT_REGISTRY_SCHEMA_VERSION) {
    throw new JsonFileError(path, "parse", `unsupported registry schema: ${String(raw.schema)}`);
  }
  if (!Array.isArray(raw.projects)) {
    throw new JsonFileError(path, "parse", "projects must be an array");
  }
  const projects = raw.projects.map((entry, index) =>
    assertConfiguredProject(path, index, entry),
  );
  if (projects.length === 0) {
    throw new JsonFileError(path, "parse", "registry must declare at least one project");
  }
  const defaultProjectId = raw.defaultProjectId;
  if (typeof defaultProjectId !== "string" || !defaultProjectId.trim()) {
    throw new JsonFileError(path, "parse", "defaultProjectId must be a non-empty string");
  }
  if (!projects.some((project) => project.projectId === defaultProjectId)) {
    throw new JsonFileError(
      path,
      "parse",
      `defaultProjectId ${defaultProjectId} does not match any registered project`,
    );
  }
  return { schema: PROJECT_REGISTRY_SCHEMA_VERSION, defaultProjectId, projects };
}
