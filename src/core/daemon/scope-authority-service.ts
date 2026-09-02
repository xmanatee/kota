import { randomUUID } from "node:crypto";
import {
  isVerifiedScopeAuthorityOperatorAction,
  type ScopeAuthorityOperatorAction,
} from "./scope-authority-operator-token.js";
import { ScopeAuthorityRevisionConflictError } from "./scope-authority-store.js";
import type {
  ScopeAuthorityCompensation,
  ScopeAuthorityFailure,
  ScopeAuthorityMutation,
  ScopeAuthorityMutationResult,
  ScopeAuthorityPersistence,
  ScopeAuthorityStoredState,
  ScopeAuthorityValidationResult,
  ScopeAuthorityView,
} from "./scope-authority-types.js";
import {
  buildScopeAuthorityAuditRecord,
  confirmationMessage,
  persistenceFailure,
  prepareScopeAuthorityChange,
  revisionConflict,
  type ScopeAuthorityValidationContext,
  scopeAuthorityViewFor,
  unknownScope,
} from "./scope-authority-validation.js";
import type {
  RestrictiveScopePolicyChange,
  RestrictiveScopePolicyChangeListener,
  ScopePolicyAuthority,
  ScopePolicySnapshot,
} from "./scope-policy-authority.js";
import { scopePolicyRestrictiveAreas } from "./scope-policy-widening.js";
import type { ScopeId, ScopeRegistry } from "./scope-registry.js";

export type ScopeTrustRevokedHandler = (scopeId: ScopeId) => void;

export class ScopeAuthorityService implements ScopePolicyAuthority {
  private mutationTail: Promise<void> = Promise.resolve();
  private readonly restrictiveChangeListeners = new Map<
    ScopeId,
    Set<RestrictiveScopePolicyChangeListener>
  >();

  constructor(
    private readonly persistence: ScopeAuthorityPersistence,
    private readonly registry: ScopeRegistry,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
    private readonly onTrustRevoked: ScopeTrustRevokedHandler = () => {},
  ) {}

  inspect(scopeId: ScopeId): ScopeAuthorityView | ScopeAuthorityFailure {
    const scope = this.registry.get(scopeId);
    if (!scope) return unknownScope(scopeId);
    try {
      return scopeAuthorityViewFor(this.registry, scope, this.persistence.read());
    } catch (error) {
      return persistenceFailure(scopeId, error);
    }
  }

  currentRevision(): number {
    return this.persistence.read().metadata.revision;
  }

  getSnapshot(scopeId: ScopeId): ScopePolicySnapshot {
    const inspected = this.inspect(scopeId);
    if (!("resolvedPolicy" in inspected)) throw new Error(inspected.message);
    return { revision: inspected.revision, policy: inspected.resolvedPolicy };
  }

  subscribeRestrictiveChanges(
    scopeId: ScopeId,
    listener: RestrictiveScopePolicyChangeListener,
  ): () => void {
    if (!this.registry.get(scopeId)) throw new Error(`Unknown directory scope ${scopeId}`);
    const listeners = this.restrictiveChangeListeners.get(scopeId) ?? new Set();
    listeners.add(listener);
    this.restrictiveChangeListeners.set(scopeId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.restrictiveChangeListeners.delete(scopeId);
    };
  }

  validate(
    scopeId: ScopeId,
    mutation: ScopeAuthorityMutation,
  ): ScopeAuthorityValidationResult {
    const result = this.prepare(scopeId, mutation);
    return "preview" in result ? result.preview : result;
  }

  apply(
    scopeId: ScopeId,
    mutation: ScopeAuthorityMutation,
    operatorAction?: ScopeAuthorityOperatorAction,
  ): Promise<ScopeAuthorityMutationResult> {
    return this.applyMutation(scopeId, mutation, operatorAction, false);
  }

  /** Apply an operator-authorized mutation that one interrupted transaction may compensate. */
  applyTransactional(
    scopeId: ScopeId,
    mutation: ScopeAuthorityMutation,
    operatorAction?: ScopeAuthorityOperatorAction,
  ): Promise<ScopeAuthorityMutationResult> {
    return this.applyMutation(scopeId, mutation, operatorAction, true);
  }

  private applyMutation(
    scopeId: ScopeId,
    mutation: ScopeAuthorityMutation,
    operatorAction: ScopeAuthorityOperatorAction | undefined,
    compensatable: boolean,
  ): Promise<ScopeAuthorityMutationResult> {
    return this.serialize(async () => {
      const prepared = this.prepare(scopeId, mutation);
      if (!("preview" in prepared)) return prepared;
      if (
        (prepared.preview.trustChanged || prepared.preview.policyChanged) &&
        !isVerifiedScopeAuthorityOperatorAction(operatorAction)
      ) {
        return {
          ok: false,
          reason: "operator_action_required",
          message: "Scope authority changes require an interactive operator client",
          scopeId,
          currentRevision: prepared.current.metadata.revision,
        };
      }
      if (
        prepared.preview.confirmationRequired &&
        operatorAction?.confirmedDangerousChange !== true
      ) {
        return {
          ok: false,
          reason: "confirmation_required",
          message: confirmationMessage(prepared.preview),
          scopeId,
          currentRevision: prepared.current.metadata.revision,
        };
      }
      if (!prepared.preview.trustChanged && !prepared.preview.policyChanged) {
        return {
          ok: true,
          status: "unchanged",
          authority: scopeAuthorityViewFor(this.registry, prepared.scope, prepared.current),
        };
      }

      const baseAuditRecord = buildScopeAuthorityAuditRecord(
        scopeId,
        mutation,
        prepared,
        this.now().toISOString(),
        this.createId(),
      );
      const auditRecord = compensatable
        ? {
            ...baseAuditRecord,
            policy: { ...baseAuditRecord.policy, compensatable: true },
          }
        : baseAuditRecord;
      const next: ScopeAuthorityStoredState = {
        ...prepared.next,
        metadata: {
          ...prepared.current.metadata,
          revision: auditRecord.revision,
          audit: [...prepared.current.metadata.audit, auditRecord],
        },
      };
      let committed: ScopeAuthorityStoredState;
      try {
        committed = await this.persistence.commit(mutation.expectedRevision, next);
      } catch (error) {
        if (error instanceof ScopeAuthorityRevisionConflictError) {
          return revisionConflict(scopeId, error.currentRevision);
        }
        return persistenceFailure(scopeId, error);
      }
      if (auditRecord.trust.before && !auditRecord.trust.after) {
        this.onTrustRevoked(scopeId);
      }
      this.publishRestrictiveChanges(prepared.current, committed);
      return {
        ok: true,
        status: "applied",
        authority: scopeAuthorityViewFor(this.registry, prepared.scope, committed),
        auditRecord,
      };
    });
  }

  /** Revert only the exact authority commit produced by an interrupted transaction. */
  compensate(
    scopeId: ScopeId,
    compensation: ScopeAuthorityCompensation,
  ): Promise<ScopeAuthorityMutationResult> {
    return this.serialize(async () => {
      const current = this.persistence.read();
      const compensatedAudit = current.metadata.audit.find(
        (record) => record.id === compensation.expectedAuditId,
      );
      const compensationAudit = [...current.metadata.audit].reverse().find(
        (record) =>
          record.scopeId === scopeId &&
          record.policy.compensationOf === compensation.expectedAuditId,
      );
      const scope = this.registry.get(scopeId);
      if (scope === undefined) return unknownScope(scopeId);
      const currentView = scopeAuthorityViewFor(this.registry, scope, current);

      // The authority commit and onboarding checkpoint cannot share one
      // filesystem transaction. Treat the exact compensation audit as its
      // durable receipt so a retry after that crash window is idempotent.
      if (
        compensatedAudit !== undefined &&
        compensatedAudit.scopeId === scopeId &&
        compensatedAudit.revision === compensation.expectedRevision &&
        compensatedAudit.policy.compensatable === true &&
        compensationAudit !== undefined &&
        !current.metadata.audit.some(
          (record) =>
            record.scopeId === scopeId &&
            record.revision > compensationAudit.revision,
        ) &&
        compensatedAudit.policy.before !== undefined &&
        compensation.trust === compensatedAudit.trust.before &&
        JSON.stringify(compensation.policy) ===
          JSON.stringify(compensatedAudit.policy.before) &&
        compensationAudit.trust.after === compensation.trust &&
        JSON.stringify(compensationAudit.policy.after) === JSON.stringify(compensation.policy) &&
        currentView.trust.trusted === compensation.trust &&
        JSON.stringify(currentView.policyFragment) === JSON.stringify(compensation.policy)
      ) {
        return { ok: true, status: "unchanged", authority: currentView };
      }
      if (
        compensatedAudit === undefined ||
        compensatedAudit.revision !== compensation.expectedRevision ||
        compensatedAudit.scopeId !== scopeId ||
        compensatedAudit.policy.compensatable !== true ||
        compensationAudit !== undefined ||
        current.metadata.audit.some(
          (record) =>
            record.scopeId === scopeId &&
            record.revision > compensatedAudit.revision,
        )
      ) {
        return revisionConflict(scopeId, current.metadata.revision);
      }
      if (
        compensatedAudit.policy.before === undefined ||
        compensatedAudit.policy.after === undefined ||
        compensation.trust !== compensatedAudit.trust.before ||
        JSON.stringify(compensation.policy) !== JSON.stringify(compensatedAudit.policy.before) ||
        currentView.trust.trusted !== compensatedAudit.trust.after ||
        JSON.stringify(currentView.policyFragment) !== JSON.stringify(compensatedAudit.policy.after)
      ) {
        return {
          ok: false,
          reason: "invalid_request",
          message: "Authority compensation does not match the audited transaction boundary",
          scopeId,
          currentRevision: current.metadata.revision,
        };
      }
      const mutation: ScopeAuthorityMutation = {
        expectedRevision: current.metadata.revision,
        reason: compensation.reason,
        trust: compensation.trust,
        policy: compensation.policy,
      };
      const prepared = this.prepare(scopeId, mutation);
      if (!("preview" in prepared)) return prepared;
      if (!prepared.preview.trustChanged && !prepared.preview.policyChanged) {
        return {
          ok: true,
          status: "unchanged",
          authority: scopeAuthorityViewFor(this.registry, prepared.scope, prepared.current),
        };
      }
      const baseAuditRecord = buildScopeAuthorityAuditRecord(
        scopeId,
        mutation,
        prepared,
        this.now().toISOString(),
        this.createId(),
      );
      const auditRecord = {
        ...baseAuditRecord,
        policy: {
          ...baseAuditRecord.policy,
          compensatable: false,
          compensationOf: compensation.expectedAuditId,
        },
      };
      const next: ScopeAuthorityStoredState = {
        ...prepared.next,
        metadata: {
          ...prepared.current.metadata,
          revision: auditRecord.revision,
          audit: [...prepared.current.metadata.audit, auditRecord],
        },
      };
      let committed: ScopeAuthorityStoredState;
      try {
        committed = await this.persistence.commit(current.metadata.revision, next);
      } catch (error) {
        if (error instanceof ScopeAuthorityRevisionConflictError) {
          return revisionConflict(scopeId, error.currentRevision);
        }
        return persistenceFailure(scopeId, error);
      }
      // The transaction owner keeps dispatch closed until either its commit or
      // this compensation is durable. This restores unpublished authority; it
      // is not a live operator revocation that needs another daemon restart.
      this.publishRestrictiveChanges(prepared.current, committed);
      return {
        ok: true,
        status: "applied",
        authority: scopeAuthorityViewFor(this.registry, prepared.scope, committed),
        auditRecord,
      };
    });
  }

  private prepare(
    scopeId: ScopeId,
    mutation: ScopeAuthorityMutation,
  ): ScopeAuthorityValidationContext | ScopeAuthorityFailure {
    return prepareScopeAuthorityChange({
      persistence: this.persistence,
      registry: this.registry,
      scopeId,
      mutation,
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private publishRestrictiveChanges(
    previousState: ScopeAuthorityStoredState,
    currentState: ScopeAuthorityStoredState,
  ): void {
    for (const scope of this.registry.list()) {
      const listeners = this.restrictiveChangeListeners.get(scope.scopeId);
      if (listeners === undefined || listeners.size === 0) continue;
      const previousView = scopeAuthorityViewFor(this.registry, scope, previousState);
      const currentView = scopeAuthorityViewFor(this.registry, scope, currentState);
      const restrictiveAreas = scopePolicyRestrictiveAreas(
        previousView.resolvedPolicy,
        currentView.resolvedPolicy,
      );
      if (restrictiveAreas.length === 0) continue;
      const change: RestrictiveScopePolicyChange = {
        scopeId: scope.scopeId,
        previous: {
          revision: previousView.revision,
          policy: previousView.resolvedPolicy,
        },
        current: {
          revision: currentView.revision,
          policy: currentView.resolvedPolicy,
        },
        restrictiveAreas,
      };
      for (const listener of [...listeners]) listener(change);
    }
  }
}
