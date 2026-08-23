import {
  resolveScopePolicy,
  type ScopePolicyFragment,
  type ScopePolicySnapshot,
} from "#core/daemon/scope-policy.js";
import {
  deriveDirectoryScopeId,
  GLOBAL_SCOPE_ID,
} from "#core/daemon/scope-registry.js";

export function scopePolicySnapshotForTest(
  projectDir: string,
  fragments: readonly ScopePolicyFragment[] = [],
  revision = 0,
): ScopePolicySnapshot {
  const scopeId = deriveDirectoryScopeId(projectDir);
  return {
    revision,
    policy: resolveScopePolicy({
      projection: {
        rootScopeId: GLOBAL_SCOPE_ID,
        defaultScopeId: scopeId,
        scopes: [
          {
            scopeId: GLOBAL_SCOPE_ID,
            displayName: "Global",
          },
          {
            scopeId,
            displayName: projectDir.split("/").pop() ?? projectDir,
            parentScopeId: GLOBAL_SCOPE_ID,
            directoryRoot: projectDir,
          },
        ],
      },
      scopeId,
      fragments,
    }),
  };
}
