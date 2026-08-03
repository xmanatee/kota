import type { ScopeId } from "#core/events/project-scope.js";
import type { ResolvedScopePolicy, ScopePolicyArea } from "./scope-policy-types.js";

/** One policy value and the authority revision that produced it. */
export type ScopePolicySnapshot = {
  readonly revision: number;
  readonly policy: ResolvedScopePolicy;
};

/** A committed policy change that removes at least one effective capability. */
export type RestrictiveScopePolicyChange = {
  readonly scopeId: ScopeId;
  readonly previous: ScopePolicySnapshot;
  readonly current: ScopePolicySnapshot;
  readonly restrictiveAreas: readonly ScopePolicyArea[];
};

export type RestrictiveScopePolicyChangeListener = (
  change: RestrictiveScopePolicyChange,
) => void;

/** Canonical live authority used by scope-policy consumers. */
export interface ScopePolicyAuthority {
  getSnapshot(scopeId: ScopeId): ScopePolicySnapshot;
  subscribeRestrictiveChanges(
    scopeId: ScopeId,
    listener: RestrictiveScopePolicyChangeListener,
  ): () => void;
}
