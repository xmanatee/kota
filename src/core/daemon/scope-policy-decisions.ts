import type { ToolEffectKind, ToolEffectScope } from "#core/tools/effect.js";
import { isScopePolicyPathWithin, resolveScopePolicyPath, resolveScopePolicyPaths } from "./scope-policy-paths.js";
import type {
  ResolvedScopePolicy,
  ScopeActionPolicy,
  ScopePolicyDecision,
  ScopePolicyDecisionQuery,
  ScopePolicySource,
  ScopePolicyToolEffectQuery,
} from "./scope-policy-types.js";

type DecisionBase = Omit<ScopePolicyDecision, "rendered">;

export function decideScopePolicy(
  policy: ResolvedScopePolicy,
  query: ScopePolicyDecisionQuery,
): ScopePolicyDecision {
  const decision = query.kind === "channel-route"
    ? decideChannel(policy, query.channel, query.source)
    : decideToolEffect(policy, query);
  return { ...decision, rendered: renderScopePolicyDecisionPlain(decision) };
}

export function renderScopePolicyDecisionPlain(
  decision: DecisionBase,
): string {
  return `${decision.target} -> ${decision.outcome} (${decision.reason}; source ${decision.source.scopeId})`;
}

export function defaultScopePolicyDecisionExamples(
  policy: ResolvedScopePolicy,
): readonly ScopePolicyDecision[] {
  return [
    decideScopePolicy(policy, {
      kind: "channel-route",
      channel: "telegram",
      source: "fixture-blocked-chat",
    }),
    decideScopePolicy(policy, {
      kind: "tool-effect",
      toolName: "edit_file",
      effectKind: "write",
      effectScope: "local-fs",
      targetPath: policy.directoryRoot
        ? `${policy.directoryRoot}/.kota/scope-policy-fixture.txt`
        : "/tmp/kota-scope-policy-fixture.txt",
    }),
    decideScopePolicy(policy, {
      kind: "tool-effect",
      toolName: "send_booking_request",
      effectKind: "write",
      effectScope: "external-network",
    }),
  ];
}

function decideChannel(
  policy: ResolvedScopePolicy,
  channel: string,
  source: string,
): DecisionBase {
  const target = `${channel} channel event from ${source}`;
  if (policy.channels.ignoredSources.includes(source)) {
    return {
      kind: "channel-route",
      target,
      outcome: "ignore",
      source: policy.channels.source,
      reason: `${source} is ignored by channel routing policy`,
    };
  }
  if (policy.channels.blockedSources.includes(source)) {
    return {
      kind: "channel-route",
      target,
      outcome: "deny",
      source: policy.channels.source,
      reason: `${source} is blocked by channel routing policy`,
    };
  }
  if (policy.channels.mode === "blocked") {
    return {
      kind: "channel-route",
      target,
      outcome: "deny",
      source: policy.channels.source,
      reason: "all channels are blocked in this scope",
    };
  }
  if (
    policy.channels.mode === "allow-list" &&
    !policy.channels.allowedChannels.includes(channel)
  ) {
    return {
      kind: "channel-route",
      target,
      outcome: "deny",
      source: policy.channels.source,
      reason: `${channel} is not in the allowed channel list`,
    };
  }
  return {
    kind: "channel-route",
    target,
    outcome: "allow",
    source: policy.channels.source,
    reason: `${channel} is eligible for this scope`,
  };
}

function decideToolEffect(
  policy: ResolvedScopePolicy,
  query: ScopePolicyToolEffectQuery,
): DecisionBase {
  const target = toolEffectTarget(query);
  const boundary = localWriteBoundary(policy, query);
  if (boundary.outcome === "deny") {
    return {
      kind: "tool-effect",
      target,
      outcome: "deny",
      source: policy.writes.source,
      reason: boundary.reason,
    };
  }
  const action = toolAction(policy, query.effectKind, query.effectScope);
  return {
    kind: "tool-effect",
    target,
    outcome: action.outcome,
    source: action.source,
    reason: boundary.reason === null
      ? `scope policy resolves this tool effect to ${action.outcome}`
      : `${boundary.reason}; owner policy resolves this tool effect to ${action.outcome}`,
  };
}

type WriteBoundaryResult =
  | { outcome: "allow"; reason: string | null }
  | { outcome: "deny"; reason: string };

function localWriteBoundary(
  policy: ResolvedScopePolicy,
  query: ScopePolicyToolEffectQuery,
): WriteBoundaryResult {
  if (query.effectScope !== "local-fs" || query.effectKind === "read") {
    return { outcome: "allow", reason: null };
  }

  if (policy.writes.mode === "none") {
    return {
      outcome: "deny",
      reason: "local filesystem writes are disabled by this scope write policy",
    };
  }

  if (policy.writes.mode === "unrestricted") {
    return { outcome: "allow", reason: "write boundary permits unrestricted local filesystem writes" };
  }

  if (query.targetPath === undefined) {
    return {
      outcome: "deny",
      reason:
        "write-capable execution tool does not expose a complete filesystem target for this bounded write policy",
    };
  }

  const requested = resolveScopePolicyPath(query.targetPath, policy.directoryRoot);
  if (requested === null) {
    return {
      outcome: "deny",
      reason: "local filesystem write target path is relative but the scope has no directory root",
    };
  }

  if (policy.writes.mode === "scope-directory") {
    if (policy.directoryRoot === undefined) {
      return {
        outcome: "deny",
        reason: "scope-directory write policy cannot be evaluated for a scope without a directory root",
      };
    }
    if (isScopePolicyPathWithin(policy.directoryRoot, requested)) {
      return { outcome: "allow", reason: "target path is inside the scope directory write boundary" };
    }
    return {
      outcome: "deny",
      reason: "target path is outside the scope directory write boundary",
    };
  }

  const allowedPaths = resolveScopePolicyPaths(policy.writes.paths, policy.directoryRoot);
  if (allowedPaths.some((allowedPath) => isScopePolicyPathWithin(allowedPath, requested))) {
    return { outcome: "allow", reason: "target path is inside an allowed write path" };
  }
  return {
    outcome: "deny",
    reason: "target path is outside the allowed write paths",
  };
}

function toolEffectTarget(query: ScopePolicyToolEffectQuery): string {
  const target = `${query.toolName} ${query.effectKind} on ${query.effectScope}`;
  if (query.effectScope === "local-fs" && query.effectKind !== "read") {
    return query.targetPath === undefined
      ? `${target} at an opaque execution target`
      : `${target} at ${query.targetPath}`;
  }
  return target;
}

function toolAction(
  policy: ResolvedScopePolicy,
  effectKind: ToolEffectKind,
  effectScope: ToolEffectScope,
): ToolActionDecision {
  const ownerAction = ownerToolAction(policy, effectKind, effectScope);
  if (effectScope !== "external-network") return ownerAction;

  const networkAction: ToolActionDecision = {
    outcome: effectKind === "read"
      ? policy.externalEffects.networkRead
      : effectKind === "write"
        ? policy.externalEffects.networkWrite
        : policy.externalEffects.networkDestructive,
    source: policy.externalEffects.source,
  };
  return moreRestrictiveAction(networkAction, ownerAction);
}

type ToolActionDecision = {
  outcome: ScopeActionPolicy;
  source: ScopePolicySource;
};

function ownerToolAction(
  policy: ResolvedScopePolicy,
  effectKind: ToolEffectKind,
  effectScope: ToolEffectScope,
): ToolActionDecision {
  const source = policy.ownerConfirmation.source;
  if (effectKind === "destructive") {
    return { outcome: policy.ownerConfirmation.destructive, source };
  }
  if (effectKind !== "write") return { outcome: "allow", source };

  switch (effectScope) {
    case "local-fs":
      return { outcome: policy.ownerConfirmation.localWrite, source };
    case "process-env":
    case "external-network":
      return { outcome: policy.ownerConfirmation.externalWrite, source };
    case "session":
    case "daemon-state":
    case "operator-surface":
      return { outcome: "allow", source };
  }
}

const ACTION_RANK: Record<ScopeActionPolicy, number> = {
  allow: 0,
  confirm: 1,
  deny: 2,
};

function moreRestrictiveAction(
  left: ToolActionDecision,
  right: ToolActionDecision,
): ToolActionDecision {
  return ACTION_RANK[right.outcome] > ACTION_RANK[left.outcome] ? right : left;
}
