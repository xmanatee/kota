import type { ScopePolicySnapshot } from "#core/daemon/scope-policy.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import type { ScopeImprovementRequest } from "../scope-improver/events.js";
import { computeScopeContentFingerprint } from "../scope-improver/scope-fingerprint.js";
import { resolveScopeImprovementAuthority } from "../scope-improver/scope-improvement-authority.js";
import { reserveScopeImprovementInput } from "../scope-improver/scope-improvement-state.js";
import type { ScopeImprovementState } from "../scope-improver/scope-improvement-types.js";
import { scopeImprovementDispatchKey } from "../scope-improver/semantic-request.js";

export type ScopeBoundaryInspection = {
  shouldEmit: boolean;
  reason: string;
  payload: ScopeImprovementRequest | null;
  nextState: ScopeImprovementState | null;
};

export function inspectScopeSemanticBoundary(args: {
  workspaceRoot: string;
  scopeRoot: string;
  scopeId: string;
  stateDir: string;
  scopePolicySnapshot: ScopePolicySnapshot;
  state: ScopeImprovementState;
}): ScopeBoundaryInspection {
  if (args.state.scopeId !== args.scopeId) {
    throw new Error("scope improvement state does not belong to its runtime scope");
  }
  const scopeId = args.scopeId;
  const state = args.state;
  let authority: ReturnType<typeof resolveScopeImprovementAuthority>;
  try {
    authority = resolveScopeImprovementAuthority({
      scopeRoot: args.scopeRoot,
      stateDir: args.stateDir,
      policy: args.scopePolicySnapshot.policy,
    });
  } catch (error) {
    return {
      shouldEmit: false,
      reason:
        "semantic scope input is parked because scope improvement authority cannot be " +
        `inspected: ${error instanceof Error ? error.message : String(error)}`,
      payload: null,
      nextState: null,
    };
  }
  if (!authority.enabled) {
    return {
      shouldEmit: false,
      reason: "semantic scope input is parked while scope improvement is disabled",
      payload: null,
      nextState: null,
    };
  }
  const worktree = getRepoWorktreeStatus(args.scopeRoot);
  if (worktree.dirty || (!worktree.available && authority.posture !== "observe")) {
    return {
      shouldEmit: false,
      reason: worktree.available
        ? "semantic scope input is parked until the canonical worktree is clean"
        : "semantic scope input requiring repository writes is parked because Git is unavailable",
      payload: null,
      nextState: null,
    };
  }
  const current = computeScopeContentFingerprint(
    args.workspaceRoot,
    args.scopePolicySnapshot.policy,
    args.stateDir,
    args.scopeRoot,
  );
  if (
    state.pendingDelivery === "deferred" &&
    authority.taskProposalDecision.outcome === "deny" &&
    authority.configuredPosture !== "observe"
  ) {
    return {
      shouldEmit: false,
      reason:
        `semantic scope input is parked while task-queue writes are denied: ` +
        authority.taskProposalDecision.reason,
      payload: null,
      nextState: null,
    };
  }
  if (!state.consumedFingerprint) {
    if (state.pendingFingerprint && state.pendingDelivery === "deferred") {
      return scopePendingDelivery({
        state,
        scopeId,
        fingerprint: current.fingerprint,
        evidenceRefs: current.refs,
        boundary: state.pendingBoundary ?? "initial-onboarding",
        deliveryAttempt: state.pendingDeliveryAttempt,
      });
    }
    return {
      shouldEmit: false,
      reason: state.pendingFingerprint
        ? "initial onboarding request is already queued and will read current inputs"
        : "initial onboarding request has not been prepared",
      payload: null,
      nextState: null,
    };
  }
  if (current.fingerprint === state.consumedFingerprint) {
    return {
      shouldEmit: false,
      reason: "scope content/policy fingerprint is unchanged",
      payload: null,
      nextState: null,
    };
  }
  if (current.fingerprint === state.pendingFingerprint) {
    if (state.pendingDelivery === "deferred") {
      return scopePendingDelivery({
        state,
        scopeId,
        fingerprint: current.fingerprint,
        evidenceRefs: current.refs,
        boundary: state.pendingBoundary ?? "content-policy-changed",
        deliveryAttempt: state.pendingDeliveryAttempt,
      });
    }
    return {
      shouldEmit: false,
      reason: "scope content/policy fingerprint is already queued",
      payload: null,
      nextState: null,
    };
  }
  const deliveryAttempt = 0;
  return {
    shouldEmit: true,
    reason: "scope content/policy fingerprint materially changed",
    payload: {
      automatic: true,
      boundary: "content-policy-changed",
      fingerprint: current.fingerprint,
      deliveryAttempt,
      idempotencyKey: scopeImprovementDispatchKey(
        scopeId,
        current.fingerprint,
        deliveryAttempt,
      ),
      evidenceRefs: current.refs,
      reason: "durable scope guidance or policy changed",
      requestedBy: "dispatcher",
    },
    nextState: reserveScopeImprovementInput(state, {
      fingerprint: current.fingerprint,
      boundary: "content-policy-changed",
      delivery: "queued",
      deliveryAttempt,
    }),
  };
}

function scopePendingDelivery(args: {
  state: ScopeImprovementState;
  scopeId: string;
  fingerprint: string;
  evidenceRefs: string[];
  boundary: "initial-onboarding" | "content-policy-changed";
  deliveryAttempt: number;
}): ScopeBoundaryInspection {
  const nextState = reserveScopeImprovementInput(args.state, {
    fingerprint: args.fingerprint,
    boundary: args.boundary,
    delivery: "queued",
    deliveryAttempt: args.deliveryAttempt,
  });
  return {
    shouldEmit: true,
    reason: `${args.boundary} scope input resumed after cleanup`,
    payload: {
      automatic: true,
      boundary: args.boundary,
      fingerprint: args.fingerprint,
      deliveryAttempt: args.deliveryAttempt,
      idempotencyKey: scopeImprovementDispatchKey(
        args.scopeId,
        args.fingerprint,
        args.deliveryAttempt,
      ),
      evidenceRefs: args.evidenceRefs,
      reason: "deferred semantic scope input resumed after canonical cleanup",
      requestedBy: "dispatcher",
    },
    nextState,
  };
}
