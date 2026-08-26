import { asArray, asObject, asOptionalString, asString, fail } from './decoder-common';

// MARK: - Scope registry projection

export type ScopeRegistryEntry = {
  scopeId: string;
  displayName: string;
  parentScopeId?: string;
  directoryRoot?: string;
};

export type ScopeRegistryProjection = {
  rootScopeId: string;
  defaultScopeId: string;
  scopes: ScopeRegistryEntry[];
};

export function parseScopeRegistryProjection(
  raw: unknown,
): ScopeRegistryProjection {
  const obj = asObject(raw, "scopes");
  const rootScopeId = asString(obj.rootScopeId, "scopes.rootScopeId");
  const defaultScopeId = asString(
    obj.defaultScopeId,
    "scopes.defaultScopeId",
  );
  const scopesRaw = asArray(obj.scopes, "scopes.scopes");
  if (scopesRaw.length === 0) {
    fail("scopes.scopes must declare at least one entry");
  }
  const scopes = scopesRaw.map((entry, index) => {
    const e = asObject(entry, `scopes.scopes[${index}]`);
    return {
      scopeId: asString(e.scopeId, `scopes.scopes[${index}].scopeId`),
      displayName: asString(
        e.displayName,
        `scopes.scopes[${index}].displayName`,
      ),
      parentScopeId: asOptionalString(
        e.parentScopeId,
        `scopes.scopes[${index}].parentScopeId`,
      ),
      directoryRoot: asOptionalString(
        e.directoryRoot,
        `scopes.scopes[${index}].directoryRoot`,
      ),
    };
  });
  if (!scopes.some((scope) => scope.scopeId === rootScopeId)) {
    fail(`scopes.rootScopeId ${rootScopeId} does not match any registered scope`);
  }
  if (!scopes.some((scope) => scope.scopeId === defaultScopeId)) {
    fail(
      `scopes.defaultScopeId ${defaultScopeId} does not match any registered scope`,
    );
  }
  return { rootScopeId, defaultScopeId, scopes };
}

export type UnknownScopeError = {
  error: "Unknown scope";
  reason: "unknown_scope";
  scopeId: string;
};

export function parseUnknownScopeError(raw: unknown): UnknownScopeError {
  const obj = asObject(raw, "unknownScopeError");
  const error = asString(obj.error, "unknownScopeError.error");
  if (error !== "Unknown scope") {
    fail(`unknownScopeError.error must be "Unknown scope", got ${error}`);
  }
  const reason = asString(obj.reason, "unknownScopeError.reason");
  if (reason !== "unknown_scope") {
    fail(
      `unknownScopeError.reason must be "unknown_scope", got ${reason}`,
    );
  }
  return {
    error,
    reason,
    scopeId: asString(obj.scopeId, "unknownScopeError.scopeId"),
  };
}
