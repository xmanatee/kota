import {
  defineProviderToken,
  type ProviderToken,
} from "#core/modules/provider-registry.js";
import type { ScopeId } from "./scope-registry.js";
import type { ScopeRuntime } from "./scope-runtime.js";

export type DaemonRuntimeScope = Pick<
  ScopeRuntime,
  "scope" | "deadLetterQueue" | "runStore" | "runState" | "ownerQuestionQueue"
>;

export type DaemonRuntimeScopeResolution =
  | { ok: true; runtime: DaemonRuntimeScope }
  | { ok: false; scopeId: string };

export type DaemonRuntimeScopeProvider = {
  resolve(scopeId: ScopeId): DaemonRuntimeScopeResolution;
};

export const DAEMON_RUNTIME_SCOPE_PROVIDER_TYPE: ProviderToken<DaemonRuntimeScopeProvider> =
  defineProviderToken<DaemonRuntimeScopeProvider>("daemon-runtime-scope");
