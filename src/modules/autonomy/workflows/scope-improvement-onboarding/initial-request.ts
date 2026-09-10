import type { ScopePolicySnapshot } from "#core/daemon/scope-policy.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import type { ScopeImprovementRequest } from "../scope-improver/events.js";
import { computeScopeContentFingerprint } from "../scope-improver/scope-fingerprint.js";
import { resolveScopeImprovementAuthority } from "../scope-improver/scope-improvement-authority.js";
import { reserveScopeImprovementInput } from "../scope-improver/scope-improvement-state.js";
import type { ScopeImprovementState } from "../scope-improver/scope-improvement-types.js";
import { scopeImprovementDispatchKey } from "../scope-improver/semantic-request.js";

export type ScopeImprovementObservation =
  | { eligible: false; reason: string }
  | {
      eligible: true;
      fingerprint: string;
      refs: string[];
      taskWritesDenied: boolean;
      taskWriteReason: string;
    };

/** Inspect canonical inputs before entering the success transaction. */
export function observeScopeImprovement(args: {
  scopeRoot: string;
  workspaceRoot?: string;
  stateDir: string;
  scopePolicySnapshot: ScopePolicySnapshot;
}): ScopeImprovementObservation {
  let authority: ReturnType<typeof resolveScopeImprovementAuthority>;
  try {
    authority = resolveScopeImprovementAuthority({ ...args, policy: args.scopePolicySnapshot.policy });
  } catch (error) {
    return { eligible: false, reason: `semantic scope input is parked because scope improvement authority cannot be inspected: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!authority.enabled) return { eligible: false, reason: "semantic scope input is parked while scope improvement is disabled" };
  const worktree = getRepoWorktreeStatus(args.scopeRoot);
  if (worktree.dirty || (!worktree.available && authority.posture !== "observe")) {
    return { eligible: false, reason: worktree.available
      ? "semantic scope input is parked until the canonical worktree is clean"
      : "semantic scope input requiring repository writes is parked because Git is unavailable" };
  }
  const current = computeScopeContentFingerprint(args.workspaceRoot ?? args.scopeRoot, args.scopePolicySnapshot.policy, args.stateDir, args.scopeRoot);
  return {
    eligible: true, fingerprint: current.fingerprint, refs: current.refs,
    taskWritesDenied: authority.configuredPosture !== "observe" && authority.taskProposalDecision.outcome === "deny",
    taskWriteReason: authority.taskProposalDecision.reason,
  };
}

export function prepareInitialScopeImprovement(args: {
  scopeRoot: string;
  stateDir: string;
  scopePolicySnapshot: ScopePolicySnapshot;
  state: ScopeImprovementState;
}): { shouldEmit: boolean; reason: string; payload: ScopeImprovementRequest | null; nextState: ScopeImprovementState | null } {
  return reserveInitialScopeImprovement(args.state, observeScopeImprovement(args));
}

export function reserveInitialScopeImprovement(state: ScopeImprovementState, observation: ScopeImprovementObservation): {
  shouldEmit: boolean; reason: string; payload: ScopeImprovementRequest | null; nextState: ScopeImprovementState | null;
} {
  const quiet = (reason: string) => ({ shouldEmit: false, reason, payload: null, nextState: null });
  if (state.consumedFingerprint || state.pendingFingerprint) return quiet("initial scope review is already reserved or consumed");
  if (!observation.eligible) return quiet(observation.reason);
  if (observation.taskWritesDenied) return quiet("initial scope review is parked by task-write authority");
  const payload: ScopeImprovementRequest = {
    automatic: true, boundary: "initial-onboarding", fingerprint: observation.fingerprint,
    deliveryAttempt: 0,
    idempotencyKey: scopeImprovementDispatchKey(state.scopeId, observation.fingerprint, 0),
    evidenceRefs: observation.refs,
    reason: "eligible hosted scope has no initial guidance/policy review",
    requestedBy: "scope-improvement-onboarding",
  };
  return {
    shouldEmit: true, reason: payload.reason!, payload,
    nextState: reserveScopeImprovementInput(state, {
      fingerprint: observation.fingerprint, boundary: "initial-onboarding", delivery: "queued", deliveryAttempt: 0,
    }),
  };
}
