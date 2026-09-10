import { dirname, join } from "node:path";
import { DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE } from "#core/daemon/runtime-scope-provider.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { getProviderRegistry } from "#core/modules/provider-registry.js";
import { KotaClientScopeError } from "#root/client/kota-client.generated.js";

/** Artifact paths belong to the scope; database authority belongs to its host. */
export function autonomyInspectionRoots(scopeRoot: string, offlineStateDir?: string) {
  const scopeId = deriveDirectoryScopeId(scopeRoot);
  const provider = getProviderRegistry()?.get(DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE);
  const hosted = provider?.resolve(scopeId);
  if (hosted && !hosted.ok) throw new KotaClientScopeError(scopeId);
  return {
    workspaceRoot: scopeRoot,
    stateDir: hosted?.ok ? dirname(hosted.runtime.runState.path) : offlineStateDir ?? join(scopeRoot, ".kota"),
    runsDir: join(scopeRoot, ".kota", "runs"),
  };
}
