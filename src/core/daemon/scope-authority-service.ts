import { randomUUID } from "node:crypto";
import {
  isVerifiedScopeAuthorityOperatorAction,
  type ScopeAuthorityOperatorAction,
} from "./scope-authority-operator-token.js";
import { ScopeAuthorityRevisionConflictError } from "./scope-authority-store.js";
import type {
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
import type { ScopeId, ScopeRegistry } from "./scope-registry.js";

export type ScopeTrustRevokedHandler = (scopeId: ScopeId) => void;

export class ScopeAuthorityService {
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(
    private readonly persistence: ScopeAuthorityPersistence,
    private readonly registry: ScopeRegistry,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
    private readonly onTrustRevoked: ScopeTrustRevokedHandler = () => {},
  ) {}

  inspect(scopeId: ScopeId): ScopeAuthorityView | ScopeAuthorityFailure {
    const project = this.registry.get(scopeId);
    if (!project) return unknownScope(scopeId);
    try {
      return scopeAuthorityViewFor(this.registry, project, this.persistence.read());
    } catch (error) {
      return persistenceFailure(scopeId, error);
    }
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
          authority: scopeAuthorityViewFor(this.registry, prepared.project, prepared.current),
        };
      }

      const auditRecord = buildScopeAuthorityAuditRecord(
        scopeId,
        mutation,
        prepared,
        this.now().toISOString(),
        this.createId(),
      );
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
      return {
        ok: true,
        status: "applied",
        authority: scopeAuthorityViewFor(this.registry, prepared.project, committed),
        auditRecord,
      };
    });
  }

  resolvePolicy(scopeId: ScopeId) {
    const inspected = this.inspect(scopeId);
    if ("resolvedPolicy" in inspected) return inspected.resolvedPolicy;
    throw new Error(inspected.message);
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
}
