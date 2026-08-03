import type {
  ResolvedScopePolicy,
  ScopeChannelRoutingPolicy,
  ScopeExternalEffectPolicy,
  ScopeModulePolicy,
  ScopeOwnerConfirmationPolicy,
  ScopePolicyArea,
  ScopePolicyExplanation,
  ScopePolicyFragment,
  ScopePolicySource,
  ScopeSetupVisibility,
} from "./scope-policy-types.js";
import { ScopePolicyValidationError } from "./scope-policy-types.js";
import {
  autonomyWiden,
  channelsWiden,
  externalEffectsWiden,
  modulesWiden,
  ownerConfirmationWiden,
  retentionWiden,
  setupRank,
  writeBoundaryWiden,
} from "./scope-policy-widening.js";

type ResolvedMutable = {
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

export function applyScopePolicyFragment(
  resolved: ResolvedMutable,
  fragment: ScopePolicyFragment,
  allowedWidening: ReadonlySet<ScopePolicyArea>,
): void {
  if (fragment.autonomy) {
    const next = mergeAutonomy(resolved.autonomy, fragment.autonomy);
    assertNoWiden(
      "autonomy",
      fragment,
      resolved.autonomy.source,
      allowedWidening,
      autonomyWiden(resolved.autonomy, next),
    );
    resolved.autonomy = sourced(next, fragment);
    explain(resolved, fragment, "autonomy");
  }
  if (fragment.writes) {
    assertNoWiden(
      "writes",
      fragment,
      resolved.writes.source,
      allowedWidening,
      writeBoundaryWiden(resolved.writes, fragment.writes, resolved.directoryRoot),
    );
    resolved.writes = sourced(fragment.writes, fragment);
    explain(resolved, fragment, "writes");
  }
  if (fragment.channels) {
    const next = mergeChannels(resolved.channels, fragment.channels);
    assertNoWiden(
      "channels",
      fragment,
      resolved.channels.source,
      allowedWidening,
      channelsWiden(resolved.channels, next),
    );
    resolved.channels = sourced(next, fragment);
    explain(resolved, fragment, "channels");
  }
  if (fragment.setup) {
    const next = mergeSetup(resolved.setup, fragment.setup);
    assertNoWiden(
      "setup",
      fragment,
      resolved.setup.source,
      allowedWidening,
      setupRank(next.visibility) > setupRank(resolved.setup.visibility),
    );
    resolved.setup = sourced(next, fragment);
    explain(resolved, fragment, "setup");
  }
  if (fragment.ownerConfirmation) {
    const next = mergeOwner(resolved.ownerConfirmation, fragment.ownerConfirmation);
    assertNoWiden(
      "ownerConfirmation",
      fragment,
      resolved.ownerConfirmation.source,
      allowedWidening,
      ownerConfirmationWiden(resolved.ownerConfirmation, next),
    );
    resolved.ownerConfirmation = sourced(next, fragment);
    explain(resolved, fragment, "ownerConfirmation");
  }
  if (fragment.retention) {
    assertNoWiden(
      "retention",
      fragment,
      resolved.retention.source,
      allowedWidening,
      retentionWiden(resolved.retention, fragment.retention),
    );
    resolved.retention = sourced(fragment.retention, fragment);
    explain(resolved, fragment, "retention");
  }
  if (fragment.modules) {
    const next = mergeModules(resolved.modules, fragment.modules);
    assertNoWiden(
      "modules",
      fragment,
      resolved.modules.source,
      allowedWidening,
      modulesWiden(resolved.modules, next),
    );
    resolved.modules = sourced(next, fragment);
    explain(resolved, fragment, "modules");
  }
  if (fragment.externalEffects) {
    const next = mergeExternal(resolved.externalEffects, fragment.externalEffects);
    assertNoWiden(
      "externalEffects",
      fragment,
      resolved.externalEffects.source,
      allowedWidening,
      externalEffectsWiden(resolved.externalEffects, next),
    );
    resolved.externalEffects = sourced(next, fragment);
    explain(resolved, fragment, "externalEffects");
  }
}

function sourced<T extends object>(
  policy: T,
  fragment: ScopePolicyFragment,
): T & { source: ScopePolicySource } {
  return { ...policy, source: { scopeId: fragment.scopeId, reason: fragment.reason } };
}

function explain(
  resolved: ResolvedMutable,
  fragment: ScopePolicyFragment,
  area: ScopePolicyArea,
): void {
  resolved.explanations.push({
    area,
    scopeId: fragment.scopeId,
    action: "override",
    message: `${fragment.scopeId} overrides ${area}: ${fragment.reason}`,
  });
}

function assertNoWiden(
  area: ScopePolicyArea,
  fragment: ScopePolicyFragment,
  parentSource: ScopePolicySource,
  allowedWidening: ReadonlySet<ScopePolicyArea>,
  widened: boolean,
): void {
  if (!widened || allowedWidening.has(area)) return;
  throw new ScopePolicyValidationError(
    `${fragment.scopeId} cannot widen ${area} beyond inherited policy without parent permission`,
    {
      kind: "parent-widening",
      scopeId: fragment.scopeId,
      parentScopeId: parentSource.scopeId,
      area,
    },
  );
}

function mergeAutonomy(
  current: ResolvedScopePolicy["autonomy"],
  next: NonNullable<ScopePolicyFragment["autonomy"]>,
): ResolvedScopePolicy["autonomy"] {
  return {
    defaultMode: next.defaultMode ?? current.defaultMode,
    maxMode: next.maxMode ?? current.maxMode,
    source: current.source,
  };
}

function mergeChannels(
  current: ScopeChannelRoutingPolicy,
  next: NonNullable<ScopePolicyFragment["channels"]>,
): ScopeChannelRoutingPolicy {
  return {
    mode: next.mode ?? current.mode,
    allowedChannels: next.allowedChannels ?? current.allowedChannels,
    blockedSources: next.blockedSources ?? current.blockedSources,
    ignoredSources: next.ignoredSources ?? current.ignoredSources,
  };
}

function mergeSetup(
  current: { visibility: ScopeSetupVisibility },
  next: NonNullable<ScopePolicyFragment["setup"]>,
): { visibility: ScopeSetupVisibility } {
  return { visibility: next.visibility ?? current.visibility };
}

function mergeOwner(
  current: ScopeOwnerConfirmationPolicy,
  next: NonNullable<ScopePolicyFragment["ownerConfirmation"]>,
): ScopeOwnerConfirmationPolicy {
  return {
    localWrite: next.localWrite ?? current.localWrite,
    externalWrite: next.externalWrite ?? current.externalWrite,
    destructive: next.destructive ?? current.destructive,
  };
}

function mergeExternal(
  current: ScopeExternalEffectPolicy,
  next: NonNullable<ScopePolicyFragment["externalEffects"]>,
): ScopeExternalEffectPolicy {
  return {
    networkRead: next.networkRead ?? current.networkRead,
    networkWrite: next.networkWrite ?? current.networkWrite,
    networkDestructive: next.networkDestructive ?? current.networkDestructive,
  };
}

function mergeModules(
  current: ScopeModulePolicy,
  next: NonNullable<ScopePolicyFragment["modules"]>,
): ScopeModulePolicy {
  const byName = new Map(current.overrides.map((entry) => [entry.moduleName, entry]));
  for (const entry of next.overrides ?? []) byName.set(entry.moduleName, entry);
  return {
    defaultAvailability: next.defaultAvailability ?? current.defaultAvailability,
    overrides: [...byName.values()].sort((a, b) => a.moduleName.localeCompare(b.moduleName)),
  };
}
