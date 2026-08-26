import { JsonFileError, writeJsonFileAtomic } from "#core/util/json-file.js";
import {
  resolveDirectoryScopeRoot,
  resolveLiveDirectoryScope,
} from "./scope-directory.js";
import {
  type DirectoryScope,
  type DirectoryScopeInput,
  loadRegistryFileFromDisk,
  SCOPE_REGISTRY_SCHEMA_VERSION,
  type ScopeId,
  type ScopeRegistryFile,
  type ScopeRegistryInit,
  type ScopeRegistryProjection,
  scopeRegistryPath,
} from "./scope-registry.js";
import { buildScopeRegistryProjection } from "./scope-registry-projection.js";

/** Persisted, atomically mutable authority for directory-backed daemon scopes. */
export class ScopeRegistry {
  private readonly stateDir: string;
  private byId = new Map<ScopeId, DirectoryScope>();
  private byRoot = new Map<string, DirectoryScope>();
  private orderedIds: ScopeId[] = [];
  private defaultScopeId: ScopeId;

  constructor(init: ScopeRegistryInit) {
    this.stateDir = init.stateDir;
    const persisted = loadRegistryFileFromDisk(init.stateDir);
    if (persisted !== null) {
      const path = scopeRegistryPath(init.stateDir);
      const scopes = persisted.scopes.map((scope, index) =>
        restorePersistedScope(path, scope, index),
      );
      assertUniqueScopes(scopes);
      this.defaultScopeId = persisted.defaultScopeId;
      this.installState(scopes, persisted.defaultScopeId);
      return;
    }
    if (init.scopes.length === 0) {
      throw new Error("ScopeRegistry requires at least one scope");
    }
    const scopes = init.scopes.map((input, index) =>
      requireLiveScope(input, `scopes[${index}]`),
    );
    assertUniqueScopes(scopes);
    const defaultScopeId = scopes[0]?.scopeId;
    if (defaultScopeId === undefined) throw new Error("ScopeRegistry resolved zero scopes");
    this.defaultScopeId = defaultScopeId;
    this.installState(scopes, defaultScopeId);
    this.persistState(scopes, defaultScopeId);
  }

  list(): readonly DirectoryScope[] {
    return this.orderedIds.map((id) => {
      const scope = this.byId.get(id);
      if (!scope) throw new Error(`ScopeRegistry: missing entry for ${id}`);
      return scope;
    });
  }

  get(scopeId: ScopeId): DirectoryScope | undefined {
    return this.byId.get(scopeId);
  }

  getByRoot(scopeRoot: string): DirectoryScope | undefined {
    resolveDirectoryScopeRoot(scopeRoot);
    const resolved = resolveLiveDirectoryScope({ scopeRoot });
    return resolved.ok ? this.byRoot.get(resolved.scope.scopeRoot) : undefined;
  }

  getDefault(): DirectoryScope {
    const scope = this.byId.get(this.defaultScopeId);
    if (!scope) {
      throw new Error(`ScopeRegistry: defaultScopeId ${this.defaultScopeId} is missing`);
    }
    return scope;
  }

  getDefaultScopeId(): ScopeId {
    return this.defaultScopeId;
  }

  add(scope: DirectoryScope): void {
    if (this.byId.has(scope.scopeId) || this.byRoot.has(scope.scopeRoot)) {
      throw new Error(`ScopeRegistry: scope ${scope.scopeId} is already registered`);
    }
    this.commitState([...this.list(), scope], this.defaultScopeId);
  }

  updateDisplayName(scopeId: ScopeId, displayNameInput: string): DirectoryScope {
    const current = this.byId.get(scopeId);
    if (!current) throw new Error(`ScopeRegistry does not contain scope ${scopeId}`);
    const displayName = displayNameInput.trim();
    if (!displayName) throw new Error("displayName must be a non-empty string");
    const updated = { ...current, displayName };
    this.commitState(
      this.list().map((scope) => scope.scopeId === scopeId ? updated : scope),
      this.defaultScopeId,
    );
    return updated;
  }

  setDefault(scopeId: ScopeId): void {
    if (!this.byId.has(scopeId)) {
      throw new Error(`ScopeRegistry does not contain scope ${scopeId}`);
    }
    this.commitState(this.list(), scopeId);
  }

  remove(scopeId: ScopeId): DirectoryScope {
    const current = this.byId.get(scopeId);
    if (!current) throw new Error(`ScopeRegistry does not contain scope ${scopeId}`);
    if (scopeId === this.defaultScopeId) {
      throw new Error("ScopeRegistry: the default scope cannot be removed");
    }
    this.commitState(
      this.list().filter((scope) => scope.scopeId !== scopeId),
      this.defaultScopeId,
    );
    return current;
  }

  toProjection(): ScopeRegistryProjection {
    return buildScopeRegistryProjection(this.defaultScopeId, this.list());
  }

  private commitState(scopes: readonly DirectoryScope[], defaultId: ScopeId): void {
    this.persistState(scopes, defaultId);
    this.installState(scopes, defaultId);
  }

  private installState(scopes: readonly DirectoryScope[], defaultId: ScopeId): void {
    if (!scopes.some((scope) => scope.scopeId === defaultId)) {
      throw new Error(`ScopeRegistry: default scope ${defaultId} is not registered`);
    }
    this.byId = new Map(scopes.map((scope) => [scope.scopeId, scope]));
    this.byRoot = new Map(scopes.map((scope) => [scope.scopeRoot, scope]));
    this.orderedIds = scopes.map((scope) => scope.scopeId);
    this.defaultScopeId = defaultId;
  }

  private persistState(scopes: readonly DirectoryScope[], defaultId: ScopeId): void {
    writeJsonFileAtomic(scopeRegistryPath(this.stateDir), {
      schema: SCOPE_REGISTRY_SCHEMA_VERSION,
      defaultScopeId: defaultId,
      scopes: scopes.map((scope) => ({ ...scope })),
    } satisfies ScopeRegistryFile);
  }
}

function restorePersistedScope(
  path: string,
  stored: DirectoryScope,
  index: number,
): DirectoryScope {
  const resolved = resolveLiveDirectoryScope(stored);
  if (!resolved.ok) {
    throw new JsonFileError(path, "parse", `scopes[${index}] cannot be restored: ${resolved.reason}`);
  }
  if (resolved.scope.scopeId !== stored.scopeId) {
    throw new JsonFileError(
      path,
      "parse",
      `scopes[${index}].scopeId does not match its canonical directory root`,
    );
  }
  return { ...resolved.scope, displayName: stored.displayName };
}

function requireLiveScope(input: DirectoryScopeInput, field: string): DirectoryScope {
  const result = resolveLiveDirectoryScope(input);
  if (result.ok) return result.scope;
  throw new Error(`${field}: ${result.message}`);
}

function assertUniqueScopes(scopes: readonly DirectoryScope[]): void {
  const seenIds = new Set<ScopeId>();
  const seenRoots = new Set<string>();
  for (const scope of scopes) {
    if (seenIds.has(scope.scopeId) || seenRoots.has(scope.scopeRoot)) {
      throw new Error(
        `ScopeRegistry: duplicate scopeRoot resolved to ${scope.scopeId} (${scope.scopeRoot})`,
      );
    }
    seenIds.add(scope.scopeId);
    seenRoots.add(scope.scopeRoot);
  }
}
