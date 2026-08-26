import {
  scopeMutationFailure,
  scopeRollbackFailure,
} from "./scope-lifecycle-errors.js";
import {
  persistenceFailure,
  registeredDirectoryScope,
  type ScopeLifecycleOptions,
  type ScopeMutationResult,
  unknownScopeMutation,
} from "./scope-lifecycle-types.js";
import type { ScopeId } from "./scope-registry.js";

type ScopeMutationEventEmitter = (
  transition: "display-name-updated" | "default-changed",
  scopeId: ScopeId,
  extra?: { previousDefaultScopeId?: ScopeId },
) => void;

export async function updateScopeDisplayName(
  options: ScopeLifecycleOptions,
  scopeId: ScopeId,
  displayNameInput: string,
  emit: ScopeMutationEventEmitter,
): Promise<ScopeMutationResult> {
  const current = options.registry.get(scopeId);
  if (!current) return unknownScopeMutation(scopeId);
  const displayName = displayNameInput.trim();
  if (!displayName) {
    return {
      ok: false,
      reason: "invalid_display_name",
      message: "displayName must be a non-empty string",
      scopeId,
    };
  }
  if (displayName === current.displayName) {
    return {
      ok: true,
      status: "unchanged",
      scope: registeredDirectoryScope(
        current.scopeId,
        current.scopeRoot,
        current.displayName,
      ),
    };
  }
  const next = { ...current, displayName };
  try {
    options.runtimes.updateScope(next);
  } catch (error) {
    return scopeMutationFailure(scopeId, "runtime_update_failed", error as Error);
  }
  try {
    const updated = options.registry.updateDisplayName(scopeId, displayName);
    emit("display-name-updated", updated.scopeId);
    return {
      ok: true,
      status: "updated",
      scope: registeredDirectoryScope(
        updated.scopeId,
        updated.scopeRoot,
        updated.displayName,
      ),
    };
  } catch (error) {
    try {
      options.runtimes.updateScope(current);
    } catch (rollbackError) {
      return scopeRollbackFailure(scopeId, error as Error, rollbackError as Error);
    }
    return persistenceFailure(scopeId, error as Error);
  }
}

export async function setDefaultScope(
  options: ScopeLifecycleOptions,
  scopeId: ScopeId,
  emit: ScopeMutationEventEmitter,
): Promise<ScopeMutationResult> {
  const next = options.registry.get(scopeId);
  if (!next) return unknownScopeMutation(scopeId);
  const previousId = options.registry.getDefaultScopeId();
  if (scopeId === previousId) {
    return {
      ok: true,
      status: "unchanged",
      scope: registeredDirectoryScope(
        next.scopeId,
        next.scopeRoot,
        next.displayName,
      ),
    };
  }
  if (!options.runtimeHost.isHosted(scopeId)) {
    return {
      ok: false,
      reason: "scope_not_hosted",
      message: `Scope ${scopeId} must be hosted before it can become the default`,
      scopeId,
    };
  }
  let registryChanged = false;
  try {
    options.registry.setDefault(scopeId);
    registryChanged = true;
    options.runtimes.setDefaultScopeId(scopeId);
  } catch (error) {
    const rollbackErrors: Error[] = [];
    if (registryChanged) {
      try {
        options.registry.setDefault(previousId);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError as Error);
      }
    }
    if (options.runtimes.getDefaultScopeId() !== previousId) {
      try {
        options.runtimes.setDefaultScopeId(previousId);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError as Error);
      }
    }
    if (rollbackErrors.length > 0) {
      return scopeRollbackFailure(scopeId, error as Error, rollbackErrors[0]!);
    }
    return scopeMutationFailure(
      scopeId,
      registryChanged ? "runtime_update_failed" : "persistence_failed",
      error as Error,
    );
  }
  emit("default-changed", scopeId, { previousDefaultScopeId: previousId });
  return {
    ok: true,
    status: "default_changed",
    scope: registeredDirectoryScope(
      next.scopeId,
      next.scopeRoot,
      next.displayName,
    ),
  };
}
