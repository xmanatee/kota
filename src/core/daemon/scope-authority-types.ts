import type { ScopeId } from "#core/events/scope.js";
import type { ResolvedScopePolicy, ScopePolicyArea, ScopePolicyFragment } from "./scope-policy.js";

export const SCOPE_AUTHORITY_SCHEMA_VERSION = 1 as const;
export const SCOPE_AUTHORITY_OPERATOR_ACTION_HEADER = "x-kota-operator-action";
export const SCOPE_AUTHORITY_OPERATOR_ACTION_VALUES = [
  "apply",
  "confirm-dangerous",
] as const;

export type ScopeAuthorityOperatorActionValue =
  (typeof SCOPE_AUTHORITY_OPERATOR_ACTION_VALUES)[number];

export type ScopeAuthorityAuditRecord = {
  id: string;
  revision: number;
  scopeId: ScopeId;
  changedAt: string;
  actor: "operator";
  reason: string;
  trust: {
    before: boolean;
    after: boolean;
  };
  policy: {
    operation: "set" | "clear" | "unchanged";
    dangerousWideningAreas: readonly ScopePolicyArea[];
  };
};

export type ScopeAuthorityMetadata = {
  schema: typeof SCOPE_AUTHORITY_SCHEMA_VERSION;
  revision: number;
  audit: readonly ScopeAuthorityAuditRecord[];
};

export type ScopeTrustDecision = {
  trusted: boolean;
  source: "kota-self-scope" | "machine-config" | "default-untrusted";
};

export type ScopeAuthorityView = {
  scopeId: ScopeId;
  directoryRoot: string;
  revision: number;
  trust: ScopeTrustDecision;
  policyFragment: ScopePolicyFragment | null;
  resolvedPolicy: ResolvedScopePolicy;
  audit: readonly ScopeAuthorityAuditRecord[];
};

export type ScopeAuthorityMutation = {
  expectedRevision: number;
  reason: string;
  trust?: boolean;
  policy?: ScopePolicyFragment | null;
};

export type ScopeAuthorityPreview = {
  ok: true;
  status: "valid";
  authority: ScopeAuthorityView;
  trustChanged: boolean;
  policyChanged: boolean;
  dangerousWideningAreas: readonly ScopePolicyArea[];
  confirmationRequired: boolean;
};

export type ScopeAuthorityFailure = {
  ok: false;
  reason:
    | "unknown_scope"
    | "invalid_request"
    | "operator_action_required"
    | "revision_conflict"
    | "parent_policy_conflict"
    | "confirmation_required"
    | "persistence_failed";
  message: string;
  scopeId: ScopeId;
  currentRevision?: number;
  conflict?: {
    parentScopeId: ScopeId;
    area: ScopePolicyArea;
  };
};

export type ScopeAuthorityValidationResult = ScopeAuthorityPreview | ScopeAuthorityFailure;

export type ScopeAuthorityMutationResult =
  | {
      ok: true;
      status: "applied" | "unchanged";
      authority: ScopeAuthorityView;
      auditRecord?: ScopeAuthorityAuditRecord;
    }
  | ScopeAuthorityFailure;

export type ScopeAuthorityStoredState = {
  trustedScopes: readonly string[];
  scopePolicies: readonly ScopePolicyFragment[];
  metadata: ScopeAuthorityMetadata;
};

export interface ScopeAuthorityPersistence {
  read(): ScopeAuthorityStoredState;
  commit(
    expectedRevision: number,
    next: ScopeAuthorityStoredState,
  ): Promise<ScopeAuthorityStoredState>;
}
