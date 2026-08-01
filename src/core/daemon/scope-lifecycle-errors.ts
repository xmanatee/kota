import type {
  ScopeHostingState,
  ScopeMutationFailure,
} from "./scope-lifecycle-types.js";
import type { ScopeId } from "./scope-registry.js";

export class ScopeChannelAdmissionError extends Error {
  constructor(
    readonly scopeId: ScopeId,
    readonly state: Exclude<ScopeHostingState, "hosted">,
  ) {
    super(`Scope ${scopeId} is ${state} and cannot accept channel work`);
    this.name = "ScopeChannelAdmissionError";
  }
}

export function requireScopeChannelAdmission(
  scopeId: ScopeId,
  registered: boolean,
  state: ScopeHostingState,
): void {
  if (registered && state === "hosted") return;
  throw new ScopeChannelAdmissionError(
    scopeId,
    state === "hosted" ? "inactive" : state,
  );
}

export function scopeMutationFailure<
  TReason extends "persistence_failed" | "runtime_update_failed",
>(
  scopeId: ScopeId,
  reason: TReason,
  error: Error,
): ScopeMutationFailure<TReason> {
  return { ok: false, reason, message: error.message, scopeId };
}

export function scopeRollbackFailure(
  scopeId: ScopeId,
  error: Error,
  rollbackError: Error,
): ScopeMutationFailure<"rollback_failed"> {
  return {
    ok: false,
    reason: "rollback_failed",
    message: `${error.message}; rollback failed: ${rollbackError.message}`,
    scopeId,
  };
}
