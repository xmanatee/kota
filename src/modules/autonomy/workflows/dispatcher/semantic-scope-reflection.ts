import type { ScopePolicySnapshot } from "#core/daemon/scope-policy.js";
import { deriveDirectoryScopeId } from "#core/daemon/scope-registry.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import type { ScopeImprovementRequest } from "../scope-improver/events.js";
import { computeScopeContentFingerprint } from "../scope-improver/scope-fingerprint.js";
import {
  readScopeImprovementState,
  writePendingScopeFingerprint,
} from "../scope-improver/scope-improvement-state.js";
import { scopeImprovementDispatchKey } from "../scope-improver/semantic-request.js";

export type ScopeBoundaryInspection = {
  shouldEmit: boolean;
  reason: string;
  payload: ScopeImprovementRequest | null;
};

export function inspectScopeSemanticBoundary(args: {
  projectDir: string;
  scopePolicySnapshot: ScopePolicySnapshot;
}): ScopeBoundaryInspection {
  const scopeId = deriveDirectoryScopeId(args.projectDir);
  const state = readScopeImprovementState(args.projectDir, scopeId);
  const worktree = getRepoWorktreeStatus(args.projectDir);
  if (!worktree.available || worktree.dirty) {
    return {
      shouldEmit: false,
      reason: "semantic scope input is parked until the canonical worktree is clean",
      payload: null,
    };
  }
  const current = computeScopeContentFingerprint(
    args.projectDir,
    args.scopePolicySnapshot.policy,
  );
  if (!state.consumedFingerprint) {
    if (state.pendingFingerprint && state.pendingDelivery === "deferred") {
      return scopePendingDelivery({
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
    };
  }
  if (current.fingerprint === state.consumedFingerprint) {
    return {
      shouldEmit: false,
      reason: "scope content/policy fingerprint is unchanged",
      payload: null,
    };
  }
  if (current.fingerprint === state.pendingFingerprint) {
    if (state.pendingDelivery === "deferred") {
      return scopePendingDelivery({
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
    };
  }
  return {
    shouldEmit: true,
    reason: "scope content/policy fingerprint materially changed",
    payload: {
      automatic: true,
      boundary: "content-policy-changed",
      fingerprint: current.fingerprint,
      deliveryAttempt: 0,
      idempotencyKey: scopeImprovementDispatchKey(
        scopeId,
        current.fingerprint,
        0,
      ),
      evidenceRefs: current.refs,
      reason: "durable scope guidance or policy changed",
      requestedBy: "dispatcher",
    },
  };
}

function scopePendingDelivery(args: {
  scopeId: string;
  fingerprint: string;
  evidenceRefs: string[];
  boundary: "initial-onboarding" | "content-policy-changed";
  deliveryAttempt: number;
}): ScopeBoundaryInspection {
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
  };
}

export function recordScopeSemanticBoundaryQueued(args: {
  projectDir: string;
  payload: ScopeImprovementRequest;
}): void {
  if (!args.payload.fingerprint) return;
  if (
    args.payload.boundary !== "initial-onboarding" &&
    args.payload.boundary !== "content-policy-changed"
  ) {
    throw new Error(
      "automatic scope improvement delivery requires a semantic boundary",
    );
  }
  writePendingScopeFingerprint({
    projectDir: args.projectDir,
    scopeId: deriveDirectoryScopeId(args.projectDir),
    fingerprint: args.payload.fingerprint,
    boundary: args.payload.boundary,
    delivery: "queued",
    deliveryAttempt:
      Number.isInteger(args.payload.deliveryAttempt) &&
        args.payload.deliveryAttempt! >= 0
        ? args.payload.deliveryAttempt!
        : 0,
  });
}
