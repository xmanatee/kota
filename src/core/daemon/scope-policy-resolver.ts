import { applyScopePolicyFragment } from "./scope-policy-apply.js";
import type {
  ResolvedScopePolicy,
  ScopeAutonomyPolicy,
  ScopeChannelRoutingPolicy,
  ScopeExternalEffectPolicy,
  ScopeModulePolicy,
  ScopeOwnerConfirmationPolicy,
  ScopePolicyArea,
  ScopePolicyExplanation,
  ScopePolicyFragment,
  ScopePolicySource,
  ScopeRetentionPolicy,
  ScopeWriteBoundary,
} from "./scope-policy-types.js";
import { ScopePolicyValidationError } from "./scope-policy-types.js";
import { GLOBAL_SCOPE_ID, type ScopeId, type ScopeRegistryProjection } from "./scope-registry.js";

const ROOT_REASON = "Built-in migration policy for existing directory scopes.";

const DEFAULT_ROOT_SCOPE_POLICY: ScopePolicyFragment = {
  scopeId: GLOBAL_SCOPE_ID,
  reason: ROOT_REASON,
  autonomy: { defaultMode: "autonomous", maxMode: "autonomous" },
  writes: { mode: "unrestricted" },
  channels: {
    mode: "allow-all",
    allowedChannels: [],
    blockedSources: [],
    ignoredSources: [],
  },
  setup: { visibility: "full" },
  ownerConfirmation: {
    localWrite: "allow",
    externalWrite: "confirm",
    destructive: "confirm",
  },
  retention: { mode: "retain", redaction: "sensitive-fields" },
  modules: { defaultAvailability: "enabled", overrides: [] },
  externalEffects: {
    networkRead: "allow",
    networkWrite: "confirm",
    networkDestructive: "confirm",
  },
};

export function defaultScopePolicyFragments(): readonly ScopePolicyFragment[] {
  return [DEFAULT_ROOT_SCOPE_POLICY];
}

type ResolvedMutable = {
  scopeId: ScopeId;
  lineage: ScopeId[];
  directoryRoot?: string;
  autonomy: ResolvedScopePolicy["autonomy"];
  writes: ResolvedScopePolicy["writes"];
  channels: ResolvedScopePolicy["channels"];
  setup: ResolvedScopePolicy["setup"];
  ownerConfirmation: ResolvedScopePolicy["ownerConfirmation"];
  retention: ResolvedScopePolicy["retention"];
  modules: ResolvedScopePolicy["modules"];
  externalEffects: ResolvedScopePolicy["externalEffects"];
  explanations: ScopePolicyExplanation[];
};

type CompleteRootPolicy = {
  scopeId: ScopeId;
  reason: string;
  allowChildWidening: readonly ScopePolicyArea[];
  autonomy: ScopeAutonomyPolicy;
  writes: ScopeWriteBoundary;
  channels: ScopeChannelRoutingPolicy;
  setup: { visibility: ResolvedScopePolicy["setup"]["visibility"] };
  ownerConfirmation: ScopeOwnerConfirmationPolicy;
  retention: ScopeRetentionPolicy;
  modules: ScopeModulePolicy;
  externalEffects: ScopeExternalEffectPolicy;
};

export function resolveScopePolicy(args: {
  projection: ScopeRegistryProjection;
  scopeId: ScopeId;
  fragments?: readonly ScopePolicyFragment[];
}): ResolvedScopePolicy {
  const lineage = scopeLineage(args.projection, args.scopeId);
  const scope = scopeFor(args.projection, args.scopeId);
  const fragmentsByScope = mergedFragmentsByScope([
    ...defaultScopePolicyFragments(),
    ...(args.fragments ?? []),
  ]);
  const base = completeRootPolicy(fragmentsByScope.get(GLOBAL_SCOPE_ID));
  const resolved: ResolvedMutable = {
    scopeId: args.scopeId,
    lineage,
    ...(scope.directoryRoot !== undefined ? { directoryRoot: scope.directoryRoot } : {}),
    autonomy: { ...base.autonomy, source: sourceOf(GLOBAL_SCOPE_ID, base.reason) },
    writes: { ...base.writes, source: sourceOf(GLOBAL_SCOPE_ID, base.reason) },
    channels: { ...base.channels, source: sourceOf(GLOBAL_SCOPE_ID, base.reason) },
    setup: { visibility: base.setup.visibility, source: sourceOf(GLOBAL_SCOPE_ID, base.reason) },
    ownerConfirmation: { ...base.ownerConfirmation, source: sourceOf(GLOBAL_SCOPE_ID, base.reason) },
    retention: { ...base.retention, source: sourceOf(GLOBAL_SCOPE_ID, base.reason) },
    modules: { ...base.modules, source: sourceOf(GLOBAL_SCOPE_ID, base.reason) },
    externalEffects: { ...base.externalEffects, source: sourceOf(GLOBAL_SCOPE_ID, base.reason) },
    explanations: [],
  };
  for (const area of POLICY_AREAS) {
    resolved.explanations.push({
      area,
      scopeId: GLOBAL_SCOPE_ID,
      action: "set",
      message: `${area} policy starts at ${GLOBAL_SCOPE_ID}.`,
    });
  }

  let allowedWidening = new Set<ScopePolicyArea>(base.allowChildWidening ?? []);
  for (const scopeId of lineage.slice(1)) {
    const fragment = fragmentsByScope.get(scopeId);
    if (!fragment) {
      resolved.explanations.push({
        area: "autonomy",
        scopeId,
        action: "inherit",
        message: `${scopeId} has no policy fragment; all areas inherit from its parent.`,
      });
      continue;
    }
    applyScopePolicyFragment(resolved, fragment, allowedWidening);
    if (fragment.allowChildWidening !== undefined) {
      allowedWidening = new Set(fragment.allowChildWidening);
    }
  }
  return resolved;
}

const POLICY_AREAS: readonly ScopePolicyArea[] = [
  "autonomy",
  "writes",
  "channels",
  "setup",
  "ownerConfirmation",
  "retention",
  "modules",
  "externalEffects",
];

function sourceOf(scopeId: ScopeId, reason: string): ScopePolicySource {
  return { scopeId, reason };
}

function scopeLineage(
  projection: ScopeRegistryProjection,
  scopeId: ScopeId,
): ScopeId[] {
  const byId = new Map(projection.scopes.map((scope) => [scope.scopeId, scope]));
  if (!byId.has(scopeId)) {
    throw new ScopePolicyValidationError(`Unknown scope ${scopeId}`);
  }
  const lineage: ScopeId[] = [];
  let current = byId.get(scopeId);
  while (current) {
    lineage.unshift(current.scopeId);
    current = current.parentScopeId ? byId.get(current.parentScopeId) : undefined;
  }
  if (lineage[0] !== GLOBAL_SCOPE_ID) {
    throw new ScopePolicyValidationError(`Scope ${scopeId} is not rooted at ${GLOBAL_SCOPE_ID}`);
  }
  return lineage;
}

function scopeFor(
  projection: ScopeRegistryProjection,
  scopeId: ScopeId,
): ScopeRegistryProjection["scopes"][number] {
  const scope = projection.scopes.find((entry) => entry.scopeId === scopeId);
  if (!scope) {
    throw new ScopePolicyValidationError(`Unknown scope ${scopeId}`);
  }
  return scope;
}

function mergedFragmentsByScope(
  fragments: readonly ScopePolicyFragment[],
): Map<ScopeId, ScopePolicyFragment> {
  const merged = new Map<ScopeId, ScopePolicyFragment>();
  for (const fragment of fragments) {
    const previous = merged.get(fragment.scopeId);
    merged.set(fragment.scopeId, previous ? mergeFragment(previous, fragment) : fragment);
  }
  return merged;
}

function mergeFragment(
  left: ScopePolicyFragment,
  right: ScopePolicyFragment,
): ScopePolicyFragment {
  return {
    scopeId: left.scopeId,
    reason: right.reason,
    allowChildWidening: right.allowChildWidening ?? left.allowChildWidening,
    autonomy: { ...left.autonomy, ...right.autonomy },
    writes: right.writes ?? left.writes,
    channels: { ...left.channels, ...right.channels },
    setup: { ...left.setup, ...right.setup },
    ownerConfirmation: { ...left.ownerConfirmation, ...right.ownerConfirmation },
    retention: right.retention ?? left.retention,
    modules: mergeModuleFragment(left.modules, right.modules),
    externalEffects: { ...left.externalEffects, ...right.externalEffects },
  };
}

function mergeModuleFragment(
  left: ScopePolicyFragment["modules"],
  right: ScopePolicyFragment["modules"],
): ScopePolicyFragment["modules"] {
  if (!left) return right;
  if (!right) return left;
  const byName = new Map(left.overrides?.map((entry) => [entry.moduleName, entry]) ?? []);
  for (const entry of right.overrides ?? []) byName.set(entry.moduleName, entry);
  return {
    defaultAvailability: right.defaultAvailability ?? left.defaultAvailability,
    overrides: [...byName.values()].sort((a, b) => a.moduleName.localeCompare(b.moduleName)),
  };
}

function completeRootPolicy(fragment: ScopePolicyFragment | undefined): CompleteRootPolicy {
  if (!fragment?.autonomy?.defaultMode || !fragment.autonomy.maxMode || !fragment.writes ||
      !fragment.channels?.mode || !fragment.setup?.visibility ||
      !fragment.ownerConfirmation?.localWrite || !fragment.ownerConfirmation.externalWrite ||
      !fragment.ownerConfirmation.destructive || !fragment.retention ||
      !fragment.modules?.defaultAvailability || !fragment.externalEffects?.networkRead ||
      !fragment.externalEffects.networkWrite || !fragment.externalEffects.networkDestructive) {
    throw new ScopePolicyValidationError("Global scope policy is incomplete");
  }
  return {
    scopeId: fragment.scopeId,
    reason: fragment.reason,
    allowChildWidening: fragment.allowChildWidening ?? [],
    autonomy: {
      defaultMode: fragment.autonomy.defaultMode,
      maxMode: fragment.autonomy.maxMode,
    },
    writes: fragment.writes,
    channels: {
      mode: fragment.channels.mode,
      allowedChannels: fragment.channels.allowedChannels ?? [],
      blockedSources: fragment.channels.blockedSources ?? [],
      ignoredSources: fragment.channels.ignoredSources ?? [],
    },
    setup: { visibility: fragment.setup.visibility },
    ownerConfirmation: {
      localWrite: fragment.ownerConfirmation.localWrite,
      externalWrite: fragment.ownerConfirmation.externalWrite,
      destructive: fragment.ownerConfirmation.destructive,
    },
    retention: fragment.retention,
    modules: {
      defaultAvailability: fragment.modules.defaultAvailability,
      overrides: fragment.modules.overrides ?? [],
    },
    externalEffects: {
      networkRead: fragment.externalEffects.networkRead,
      networkWrite: fragment.externalEffects.networkWrite,
      networkDestructive: fragment.externalEffects.networkDestructive,
    },
  };
}
