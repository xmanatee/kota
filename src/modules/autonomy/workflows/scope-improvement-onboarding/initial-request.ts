import type { ScopePolicySnapshot } from "#core/daemon/scope-policy.js";
import { getRepoWorktreeStatus } from "#core/util/repo-worktree.js";
import type { ScopeImprovementRequest } from "../scope-improver/events.js";
import { computeScopeContentFingerprint } from "../scope-improver/scope-fingerprint.js";
import { resolveScopeImprovementAuthority } from "../scope-improver/scope-improvement-authority.js";
import { reserveScopeImprovementInput } from "../scope-improver/scope-improvement-state.js";
import type { ScopeImprovementState } from "../scope-improver/scope-improvement-types.js";
import { scopeImprovementDispatchKey } from "../scope-improver/semantic-request.js";

export function prepareInitialScopeImprovement(args: {
  scopeRoot: string;
  stateDir: string;
  scopePolicySnapshot: ScopePolicySnapshot;
  state: ScopeImprovementState;
}): { shouldEmit: boolean; reason: string; payload: ScopeImprovementRequest | null; nextState: ScopeImprovementState | null } {
  const quiet = (reason: string) => ({ shouldEmit: false, reason, payload: null, nextState: null });
  if (args.state.consumedFingerprint || args.state.pendingFingerprint) return quiet("initial scope review is already reserved or consumed");
  const authority = resolveScopeImprovementAuthority({ ...args, policy: args.scopePolicySnapshot.policy });
  if (!authority.enabled) return quiet("initial scope review is disabled");
  if (authority.configuredPosture !== "observe" && authority.taskProposalDecision.outcome === "deny") return quiet("initial scope review is parked by task-write authority");
  const worktree = getRepoWorktreeStatus(args.scopeRoot);
  if (worktree.dirty || (!worktree.available && authority.posture !== "observe")) return quiet("initial scope review awaits an eligible repository");
  const fingerprint = computeScopeContentFingerprint(args.scopeRoot, args.scopePolicySnapshot.policy, args.stateDir);
  const payload: ScopeImprovementRequest = {
    automatic: true, boundary: "initial-onboarding", fingerprint: fingerprint.fingerprint,
    deliveryAttempt: 0,
    idempotencyKey: scopeImprovementDispatchKey(args.state.scopeId, fingerprint.fingerprint, 0),
    evidenceRefs: fingerprint.refs,
    reason: "eligible hosted scope has no initial guidance/policy review",
    requestedBy: "scope-improvement-onboarding",
  };
  return {
    shouldEmit: true, reason: payload.reason!, payload,
    nextState: reserveScopeImprovementInput(args.state, {
      fingerprint: fingerprint.fingerprint, boundary: "initial-onboarding", delivery: "queued", deliveryAttempt: 0,
    }),
  };
}
