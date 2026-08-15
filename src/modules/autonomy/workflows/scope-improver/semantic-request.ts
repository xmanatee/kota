import { DAEMON_PROJECT_SCOPE_PROVIDER_TYPE } from "#core/daemon/project-scope-provider.js";
import type { ScopePolicySnapshot } from "#core/daemon/scope-policy.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import type { BusEvents } from "#core/events/event-bus.js";
import type { ModuleRuntimeContext } from "#core/modules/module-types.js";
import type {
  WorkflowTriggerAdmissionDecision,
  WorkflowTriggerAdmissionInput,
} from "#core/workflow/types.js";
import {
  type ScopeImprovementRequest,
  scopeImprovementRequested,
} from "./events.js";
import { computeScopeContentFingerprint } from "./scope-fingerprint.js";
import {
  readScopeImprovementState,
  writePendingScopeFingerprint,
} from "./scope-improvement-state.js";

export function scopeImprovementDispatchKey(
  scopeId: string,
  fingerprint: string,
  deliveryAttempt: number,
): string {
  return `scope-improvement:${scopeId}:${fingerprint}:${deliveryAttempt}`;
}

/**
 * Reserve the one initial request for a newly activated scope. Onboarding calls
 * this immediately before emit; the pending fingerprint makes repeated
 * activation and restart a no-op before workflow queue insertion.
 */
export function prepareInitialScopeImprovementRequest(args: {
  projectDir: string;
  requestedBy: string;
  scopePolicySnapshot: ScopePolicySnapshot;
}): ScopeImprovementRequest | null {
  const scopeId = deriveDirectoryScopeId(args.projectDir);
  const state = readScopeImprovementState(args.projectDir, scopeId);
  if (state.consumedFingerprint || state.pendingFingerprint) return null;
  const current = computeScopeContentFingerprint(
    args.projectDir,
    args.scopePolicySnapshot.policy,
  );
  writePendingScopeFingerprint({
    projectDir: args.projectDir,
    scopeId,
    fingerprint: current.fingerprint,
    boundary: "initial-onboarding",
    delivery: "queued",
    deliveryAttempt: 0,
  });
  return {
    automatic: true,
    boundary: "initial-onboarding",
    fingerprint: current.fingerprint,
    deliveryAttempt: 0,
    idempotencyKey: scopeImprovementDispatchKey(
      scopeId,
      current.fingerprint,
      0,
    ),
    evidenceRefs: current.refs,
    reason: "newly activated scope is ready for its initial improvement review",
    requestedBy: args.requestedBy,
  };
}

type ScopeOnboardingContext = Pick<
  ModuleRuntimeContext,
  "events" | "getProvider" | "log"
>;

export function handleRegisteredScopeImprovementOnboarding(
  ctx: ScopeOnboardingContext,
  lifecycle: BusEvents["scope.lifecycle.changed"],
): void {
  if (lifecycle.transition !== "registered") return;
  let prepared: ScopeImprovementRequest | null = null;
  try {
    const provider = ctx.getProvider(DAEMON_PROJECT_SCOPE_PROVIDER_TYPE);
    if (!provider) {
      throw new Error("daemon scope authority is unavailable");
    }
    const resolved = provider.resolveProjectRuntime(lifecycle.affectedScopeId);
    if (!resolved.ok) {
      throw new Error(`registered scope ${lifecycle.affectedScopeId} is unavailable`);
    }
    const runtime = resolved.runtime;
    if (
      runtime.project.projectId !== lifecycle.affectedScopeId ||
      runtime.project.projectDir !== lifecycle.directoryRoot
    ) {
      throw new Error(
        `registered scope authority mismatch for ${lifecycle.affectedScopeId}`,
      );
    }
    if (!runtime.scopePolicyAuthority) {
      throw new Error(
        `resolved scope policy is unavailable for ${lifecycle.affectedScopeId}`,
      );
    }
    prepared = prepareInitialScopeImprovementRequest({
      projectDir: runtime.project.projectDir,
      requestedBy: "scope-lifecycle:registered",
      scopePolicySnapshot: runtime.scopePolicyAuthority.getSnapshot(
        lifecycle.affectedScopeId,
      ),
    });
    if (!prepared) return;
    ctx.events.emit(scopeImprovementRequested, {
      ...prepared,
      scopeId: lifecycle.affectedScopeId,
      projectId: lifecycle.affectedScopeId,
    });
  } catch (error) {
    if (prepared?.fingerprint) {
      writePendingScopeFingerprint({
        projectDir: lifecycle.directoryRoot,
        scopeId: lifecycle.affectedScopeId,
        fingerprint: prepared.fingerprint,
        boundary: "initial-onboarding",
        delivery: "deferred",
        deliveryAttempt: (prepared.deliveryAttempt ?? 0) + 1,
      });
    }
    ctx.log.warn(
      `Initial scope-improvement activation parked for ` +
        `${lifecycle.affectedScopeId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
  }
}

export function subscribeScopeImprovementOnboarding(
  ctx: ScopeOnboardingContext,
): void {
  ctx.events.subscribe("scope.lifecycle.changed", (lifecycle) => {
    handleRegisteredScopeImprovementOnboarding(ctx, lifecycle);
  });
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
  const scopeId = deriveDirectoryScopeId(input.projectDir);
  const state = readScopeImprovementState(input.projectDir, scopeId);
  const deliveryAttempt = Number.isInteger(payload.deliveryAttempt) &&
      payload.deliveryAttempt! >= 0
    ? payload.deliveryAttempt!
    : 0;
  if (
    payload.idempotencyKey !== scopeImprovementDispatchKey(
      scopeId,
      payload.fingerprint,
      deliveryAttempt,
    )
  ) {
    return {
      admitted: false,
      reason: "automatic scope input has no canonical dispatch key",
    };
  }
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
