import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type {
  WorkflowTriggerAdmissionDecision,
  WorkflowTriggerAdmissionInput,
} from "#core/workflow/types.js";
import type { ScopeImprovementRequest } from "./events.js";
import {
  decodeScopeImprovementState,
  SCOPE_IMPROVEMENT_STATE_KEY,
} from "./scope-improvement-state.js";
import type { ScopeImprovementState } from "./scope-improvement-types.js";

export function scopeImprovementDispatchKey(
  scopeId: string,
  fingerprint: string,
  deliveryAttempt: number,
): string {
  return `scope-improvement:${scopeId}:${fingerprint}:${deliveryAttempt}`;
}

export function admitScopeImprovementTrigger(
  input: WorkflowTriggerAdmissionInput,
): WorkflowTriggerAdmissionDecision {
  const payload = input.trigger.payload as ScopeImprovementRequest;
  if (payload.automatic !== true) return { admitted: true };
  if (
    (payload.boundary !== "initial-onboarding" &&
      payload.boundary !== "content-policy-changed") ||
    typeof payload.fingerprint !== "string" ||
    payload.fingerprint.length === 0
  ) {
    return {
      admitted: false,
      reason: "automatic scope input is missing its semantic fingerprint",
    };
  }
  const deliveryAttempt = Number.isSafeInteger(payload.deliveryAttempt) &&
      payload.deliveryAttempt! >= 0
    ? payload.deliveryAttempt!
    : 0;
  const scopeId = deriveDirectoryScopeId(input.projectDir);
  const expected = scopeImprovementDispatchKey(
    scopeId,
    payload.fingerprint,
    deliveryAttempt,
  );
  if (payload.idempotencyKey !== expected) {
    return {
      admitted: false,
      reason: "automatic scope input has no canonical dispatch key",
    };
  }
  const state = decodeScopeImprovementState(
    input.state.read<ScopeImprovementState>(SCOPE_IMPROVEMENT_STATE_KEY).value,
    scopeId,
  );
  if (payload.fingerprint === state.consumedFingerprint) {
    return {
      admitted: false,
      reason: `scope fingerprint ${payload.fingerprint} was already consumed`,
    };
  }
  if (state.pendingFingerprint === null) {
    return {
      admitted: false,
      reason: "automatic scope input has no pending semantic reservation",
    };
  }
  if (payload.fingerprint !== state.pendingFingerprint) {
    return {
      admitted: false,
      reason:
        `scope fingerprint ${payload.fingerprint} was superseded by ` +
        state.pendingFingerprint,
    };
  }
  return { admitted: true };
}
