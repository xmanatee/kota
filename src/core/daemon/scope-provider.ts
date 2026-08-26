import {
  defineProviderToken,
  type ProviderToken,
} from "#core/modules/provider-registry.js";
import type { UnknownScopeError } from "./daemon-control-types.js";
import type { ScopeId, ScopeRegistryProjection } from "./scope-registry.js";
import type { ScopeRuntime } from "./scope-runtime.js";

export type DaemonScopeRuntime = Pick<
  ScopeRuntime,
  | "scope"
  | "authorityConfigPath"
  | "approvalQueue"
  | "secretStore"
  | "ownerDecisionStore"
  | "ownerQuestionQueue"
  | "scopePolicyAuthority"
>;

export type DaemonScopeRuntimeResolution =
  | { ok: true; runtime: DaemonScopeRuntime }
  | { ok: false; error: UnknownScopeError };

export type DaemonScopeProvider = {
  getScopeRegistryProjection(): ScopeRegistryProjection;
  getActiveScopeId(): ScopeId | null;
  resolveScopeRuntime(
    scopeId?: string | null,
  ): DaemonScopeRuntimeResolution;
};

export const DAEMON_SCOPE_PROVIDER_TYPE: ProviderToken<DaemonScopeProvider> =
  defineProviderToken<DaemonScopeProvider>("daemon-scope");
