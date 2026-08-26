import type {
  DirectoryScope,
  DirectoryScopeInput,
  ScopeId,
  ScopeRegistryProjection,
} from "./scope-registry.js";

export const GLOBAL_SCOPE_ID = "global";

export function buildScopeRegistryProjection(
  defaultScopeId: ScopeId,
  scopes: readonly DirectoryScope[],
): ScopeRegistryProjection {
  return {
    rootScopeId: GLOBAL_SCOPE_ID,
    defaultScopeId,
    scopes: [
      { scopeId: GLOBAL_SCOPE_ID, displayName: "Global" },
      ...scopes.map((scope) => ({
        scopeId: scope.scopeId,
        displayName: scope.displayName,
        parentScopeId: GLOBAL_SCOPE_ID,
        directoryRoot: scope.scopeRoot,
      })),
    ],
  };
}

export function resolveConfiguredScopes(opts: {
  scopes?: readonly DirectoryScopeInput[];
  scopeRoot?: string;
  fallbackScopeRoot: string;
}): readonly DirectoryScopeInput[] {
  if (opts.scopes && opts.scopes.length > 0) {
    opts.scopes.forEach((scope, index) => {
      assertNonEmptyScopeRoot(scope.scopeRoot, `scopes[${index}].scopeRoot`);
    });
    return opts.scopes;
  }
  if (opts.scopeRoot !== undefined) {
    assertNonEmptyScopeRoot(opts.scopeRoot, "scopeRoot");
    return [{ scopeRoot: opts.scopeRoot }];
  }
  assertNonEmptyScopeRoot(opts.fallbackScopeRoot, "fallbackScopeRoot");
  return [{ scopeRoot: opts.fallbackScopeRoot }];
}

function assertNonEmptyScopeRoot(scopeRoot: string, field: string): void {
  if (!scopeRoot.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
}
