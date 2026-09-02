import {
  normalizeScopeTrustPath,
  resolveScopeConfigTrust,
} from "#core/config/config.js";
import type {
  ScopeAuthorityAuditRecord,
  ScopeAuthorityFailure,
  ScopeAuthorityMutation,
  ScopeAuthorityPersistence,
  ScopeAuthorityPreview,
  ScopeAuthorityStoredState,
  ScopeAuthorityView,
  ScopeTrustDecision,
} from "./scope-authority-types.js";
import {
  resolveScopePolicy,
  type ScopePolicyArea,
  type ScopePolicyFragment,
  ScopePolicyValidationError,
} from "./scope-policy.js";
import { scopePolicyWideningAreas } from "./scope-policy-widening.js";
import type { DirectoryScope, ScopeId, ScopeRegistry } from "./scope-registry.js";

type BoundaryValue = unknown;

export type ScopeAuthorityValidationContext = {
  preview: ScopeAuthorityPreview;
  current: ScopeAuthorityStoredState;
  next: ScopeAuthorityStoredState;
  scope: DirectoryScope;
  before: ScopeAuthorityView;
};

export function prepareScopeAuthorityChange(args: {
  persistence: ScopeAuthorityPersistence;
  registry: ScopeRegistry;
  scopeId: ScopeId;
  mutation: ScopeAuthorityMutation;
}): ScopeAuthorityValidationContext | ScopeAuthorityFailure {
  const { persistence, registry, scopeId, mutation } = args;
  const scope = registry.get(scopeId);
  if (!scope) return unknownScope(scopeId);
  let current: ScopeAuthorityStoredState;
  try {
    current = persistence.read();
  } catch (error) {
    return persistenceFailure(scopeId, error);
  }
  if (mutation.expectedRevision !== current.metadata.revision) {
    return revisionConflict(scopeId, current.metadata.revision);
  }
  if (!mutation.reason.trim()) {
    return invalidRequest(scopeId, "Authority mutation reason must not be empty");
  }
  if (mutation.policy !== undefined && mutation.policy !== null && mutation.policy.scopeId !== scopeId) {
    return invalidRequest(scopeId, `Policy scopeId must be ${scopeId}`);
  }

  const currentView = scopeAuthorityViewFor(registry, scope, current);
  const trusted = mutation.trust ?? currentView.trust.trusted;
  if (currentView.trust.source === "kota-self-scope" && !trusted) {
    return invalidRequest(scopeId, "The KOTA source scope is intrinsically trusted");
  }
  const nextPolicies = mutation.policy === undefined
    ? current.scopePolicies
    : updateScopePolicies(current.scopePolicies, scopeId, mutation.policy);
  const next: ScopeAuthorityStoredState = {
    trustedScopes: updateTrustedScopes(current.trustedScopes, scope.scopeRoot, trusted),
    scopePolicies: nextPolicies,
    metadata: current.metadata,
  };
  let nextView: ScopeAuthorityView;
  try {
    assertEveryPolicyResolves(registry, nextPolicies);
    nextView = scopeAuthorityViewFor(registry, scope, next);
  } catch (error) {
    if (error instanceof ScopePolicyValidationError && error.conflict) {
      return {
        ok: false,
        reason: "parent_policy_conflict",
        message: error.message,
        scopeId,
        currentRevision: current.metadata.revision,
        conflict: {
          parentScopeId: error.conflict.parentScopeId,
          area: error.conflict.area,
        },
      };
    }
    return invalidRequest(scopeId, error instanceof Error ? error.message : String(error));
  }

  const dangerousWideningAreas = unionAreas(
    scopePolicyWideningAreas(currentView.resolvedPolicy, nextView.resolvedPolicy),
    childWideningGrants(currentView.policyFragment, nextView.policyFragment),
  );
  const trustChanged = currentView.trust.trusted !== nextView.trust.trusted;
  const policyChanged = JSON.stringify(currentView.policyFragment) !==
    JSON.stringify(nextView.policyFragment);
  const preview: ScopeAuthorityPreview = {
    ok: true,
    status: "valid",
    authority: nextView,
    trustChanged,
    policyChanged,
    dangerousWideningAreas,
    confirmationRequired: (!currentView.trust.trusted && nextView.trust.trusted) ||
      dangerousWideningAreas.length > 0,
  };
  return { preview, current, next, scope, before: currentView };
}

export function scopeAuthorityViewFor(
  registry: ScopeRegistry,
  scope: DirectoryScope,
  state: ScopeAuthorityStoredState,
): ScopeAuthorityView {
  const policyFragment = state.scopePolicies.find((entry) => entry.scopeId === scope.scopeId) ?? null;
  return {
    scopeId: scope.scopeId,
    directoryRoot: scope.scopeRoot,
    revision: state.metadata.revision,
    trust: trustDecision(scope.scopeRoot, state.trustedScopes),
    policyFragment,
    resolvedPolicy: resolveScopePolicy({
      projection: registry.toProjection(),
      scopeId: scope.scopeId,
      fragments: state.scopePolicies,
    }),
    audit: state.metadata.audit.filter((entry) => entry.scopeId === scope.scopeId),
  };
}

export function buildScopeAuthorityAuditRecord(
  scopeId: ScopeId,
  mutation: ScopeAuthorityMutation,
  prepared: ScopeAuthorityValidationContext,
  changedAt: string,
  id: string,
): ScopeAuthorityAuditRecord {
  return {
    id,
    revision: prepared.current.metadata.revision + 1,
    scopeId,
    changedAt,
    actor: "operator",
    reason: mutation.reason.trim(),
    trust: {
      before: prepared.before.trust.trusted,
      after: prepared.preview.authority.trust.trusted,
    },
    policy: {
      operation: !prepared.preview.policyChanged
        ? "unchanged"
        : mutation.policy === null ? "clear" : "set",
      dangerousWideningAreas: prepared.preview.dangerousWideningAreas,
      before: prepared.before.policyFragment,
      after: prepared.preview.authority.policyFragment,
    },
  };
}

export function confirmationMessage(preview: ScopeAuthorityPreview): string {
  const changes = [
    ...(preview.trustChanged && preview.authority.trust.trusted ? ["scope trust"] : []),
    ...preview.dangerousWideningAreas.map((area) => `${area} policy widening`),
  ];
  return `Explicit operator confirmation is required for ${changes.join(" and ")}`;
}

export function unknownScope(scopeId: ScopeId): ScopeAuthorityFailure {
  return { ok: false, reason: "unknown_scope", message: `Unknown directory scope ${scopeId}`, scopeId };
}

export function revisionConflict(scopeId: ScopeId, currentRevision: number): ScopeAuthorityFailure {
  return {
    ok: false,
    reason: "revision_conflict",
    message: `Scope authority changed; current revision is ${currentRevision}`,
    scopeId,
    currentRevision,
  };
}

export function persistenceFailure(scopeId: ScopeId, error: BoundaryValue): ScopeAuthorityFailure {
  return {
    ok: false,
    reason: "persistence_failed",
    message: error instanceof Error ? error.message : String(error),
    scopeId,
  };
}

function invalidRequest(scopeId: ScopeId, message: string): ScopeAuthorityFailure {
  return { ok: false, reason: "invalid_request", message, scopeId };
}

function trustDecision(scopeRoot: string, trustedScopes: readonly string[]): ScopeTrustDecision {
  const decision = resolveScopeConfigTrust(scopeRoot, { trustedScopes: [...trustedScopes] });
  if (decision.reason === "kota-self-scope") return { trusted: true, source: "kota-self-scope" };
  if (decision.trusted) return { trusted: true, source: "machine-config" };
  return { trusted: false, source: "default-untrusted" };
}

function updateTrustedScopes(
  current: readonly string[],
  scopeRoot: string,
  trusted: boolean,
): string[] {
  const normalized = normalizeScopeTrustPath(scopeRoot);
  const retained = current.filter((entry) => normalizeScopeTrustPath(entry) !== normalized);
  if (trusted) retained.push(normalized);
  return [...new Set(retained)].sort();
}

function updateScopePolicies(
  current: readonly ScopePolicyFragment[],
  scopeId: ScopeId,
  policy: ScopePolicyFragment | null,
): ScopePolicyFragment[] {
  const retained = current.filter((entry) => entry.scopeId !== scopeId);
  if (policy !== null) retained.push(policy);
  return retained.sort((a, b) => a.scopeId.localeCompare(b.scopeId));
}

function assertEveryPolicyResolves(
  registry: ScopeRegistry,
  policies: readonly ScopePolicyFragment[],
): void {
  const projection = registry.toProjection();
  for (const scope of projection.scopes) {
    resolveScopePolicy({ projection, scopeId: scope.scopeId, fragments: policies });
  }
}

function childWideningGrants(
  current: ScopePolicyFragment | null,
  next: ScopePolicyFragment | null,
): ScopePolicyArea[] {
  const existing = new Set(current?.allowChildWidening ?? []);
  return (next?.allowChildWidening ?? []).filter((area) => !existing.has(area));
}

function unionAreas(left: readonly ScopePolicyArea[], right: readonly ScopePolicyArea[]): ScopePolicyArea[] {
  return [...new Set([...left, ...right])].sort();
}
