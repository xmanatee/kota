/**
 * Persisted directory-scope identity and registry state.
 *
 * The first daemon boot seeds this registry from configuration. Once the
 * registry file exists it is the runtime authority: later config input does
 * not erase live registrations, display names, or the selected default.
 */

import { join } from "node:path";
import type { ScopeId } from "#core/events/scope.js";
import {
  JsonFileError,
  readOptionalJsonFile,
} from "#core/util/json-file.js";

export type { DirectoryScopeResolution } from "./scope-directory.js";
export { buildDirectoryScope, deriveDirectoryScopeId } from "./scope-directory.js";
export {
  buildScopeRegistryProjection,
  GLOBAL_SCOPE_ID,
  resolveConfiguredScopes,
} from "./scope-registry-projection.js";

export type { ScopeId };

export type DirectoryScopeInput = {
  scopeRoot: string;
  displayName?: string;
};

export type DirectoryScope = {
  readonly scopeId: ScopeId;
  readonly scopeRoot: string;
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

/** Return the directory-backed scopes from the public hierarchical graph. */
export function directoryScopesFromProjection(
  projection: ScopeRegistryProjection,
): DirectoryScope[] {
  return projection.scopes.flatMap((scope) =>
    scope.directoryRoot === undefined
      ? []
      : [{
          scopeId: scope.scopeId,
          scopeRoot: scope.directoryRoot,
          displayName: scope.displayName,
        }]
  );
}

export const SCOPE_REGISTRY_SCHEMA_VERSION = 1;
const REGISTRY_FILE = "scope-registry.json";

export type ScopeRegistryFile = {
  schema: typeof SCOPE_REGISTRY_SCHEMA_VERSION;
  defaultScopeId: ScopeId;
  scopes: DirectoryScope[];
};

export type ScopeRegistryInit = {
  stateDir: string;
  scopes: readonly DirectoryScopeInput[];
};

export { ScopeRegistry } from "./scope-registry-state.js";

export function loadRegistryFileFromDisk(
  stateDir: string,
): ScopeRegistryFile | null {
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

function assertDirectoryScope(
  path: string,
  index: number,
  raw: unknown,
): DirectoryScope {
  if (!isPlainObject(raw)) {
    throw new JsonFileError(path, "parse", `scopes[${index}] is not an object`);
  }
  const { scopeId, scopeRoot, displayName } = raw;
  if (typeof scopeId !== "string" || !scopeId.trim()) {
    throw new JsonFileError(path, "parse", `scopes[${index}].scopeId must be a non-empty string`);
  }
  if (typeof scopeRoot !== "string" || !scopeRoot.trim()) {
    throw new JsonFileError(path, "parse", `scopes[${index}].scopeRoot must be a non-empty string`);
  }
  if (typeof displayName !== "string" || !displayName.trim()) {
    throw new JsonFileError(path, "parse", `scopes[${index}].displayName must be a non-empty string`);
  }
  return { scopeId, scopeRoot, displayName };
}

function assertRegistryFile(path: string, raw: unknown): ScopeRegistryFile {
  if (!isPlainObject(raw)) {
    throw new JsonFileError(path, "parse", "registry file is not an object");
  }
  if (raw.schema !== SCOPE_REGISTRY_SCHEMA_VERSION) {
    throw new JsonFileError(path, "parse", `unsupported registry schema: ${String(raw.schema)}`);
  }
  if (!Array.isArray(raw.scopes)) {
    throw new JsonFileError(path, "parse", "scopes must be an array");
  }
  const scopes = raw.scopes.map((entry, index) =>
    assertDirectoryScope(path, index, entry),
  );
  if (scopes.length === 0) {
    throw new JsonFileError(path, "parse", "registry must declare at least one scope");
  }
  const defaultScopeId = raw.defaultScopeId;
  if (typeof defaultScopeId !== "string" || !defaultScopeId.trim()) {
    throw new JsonFileError(path, "parse", "defaultScopeId must be a non-empty string");
  }
  if (!scopes.some((scope) => scope.scopeId === defaultScopeId)) {
    throw new JsonFileError(
      path,
      "parse",
      `defaultScopeId ${defaultScopeId} does not match any registered scope`,
    );
  }
  return { schema: SCOPE_REGISTRY_SCHEMA_VERSION, defaultScopeId, scopes };
}
