import { isScopePolicyPathWithin, resolveScopePolicyPaths } from "./scope-policy-paths.js";
import type {
  ResolvedScopePolicy,
  ScopeActionPolicy,
  ScopeChannelRoutingPolicy,
  ScopeExternalEffectPolicy,
  ScopeModuleAvailability,
  ScopeModulePolicy,
  ScopeOwnerConfirmationPolicy,
  ScopePolicyArea,
  ScopePolicyExplanation,
  ScopePolicyFragment,
  ScopePolicySource,
  ScopeRedactionProfile,
  ScopeRetentionPolicy,
  ScopeSetupVisibility,
  ScopeWriteBoundary,
} from "./scope-policy-types.js";
import { ScopePolicyValidationError } from "./scope-policy-types.js";

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
    assertNoWiden("autonomy", fragment, allowedWidening, autonomyWiden(resolved.autonomy, next));
    resolved.autonomy = sourced(next, fragment);
    explain(resolved, fragment, "autonomy");
  }
  if (fragment.writes) {
    assertNoWiden(
      "writes",
      fragment,
      allowedWidening,
      writeBoundaryWiden(resolved.writes, fragment.writes, resolved.directoryRoot),
    );
    resolved.writes = sourced(fragment.writes, fragment);
    explain(resolved, fragment, "writes");
  }
  if (fragment.channels) {
    const next = mergeChannels(resolved.channels, fragment.channels);
    assertNoWiden("channels", fragment, allowedWidening, channelsWiden(resolved.channels, next));
    resolved.channels = sourced(next, fragment);
    explain(resolved, fragment, "channels");
  }
  if (fragment.setup) {
    const next = mergeSetup(resolved.setup, fragment.setup);
    assertNoWiden("setup", fragment, allowedWidening, setupRank(next.visibility) > setupRank(resolved.setup.visibility));
    resolved.setup = sourced(next, fragment);
    explain(resolved, fragment, "setup");
  }
  if (fragment.ownerConfirmation) {
    const next = mergeOwner(resolved.ownerConfirmation, fragment.ownerConfirmation);
    assertNoWiden("ownerConfirmation", fragment, allowedWidening, actionPolicyWiden(resolved.ownerConfirmation, next));
    resolved.ownerConfirmation = sourced(next, fragment);
    explain(resolved, fragment, "ownerConfirmation");
  }
  if (fragment.retention) {
    assertNoWiden("retention", fragment, allowedWidening, retentionWiden(resolved.retention, fragment.retention));
    resolved.retention = sourced(fragment.retention, fragment);
    explain(resolved, fragment, "retention");
  }
  if (fragment.modules) {
    const next = mergeModules(resolved.modules, fragment.modules);
    assertNoWiden("modules", fragment, allowedWidening, modulesWiden(resolved.modules, next));
    resolved.modules = sourced(next, fragment);
    explain(resolved, fragment, "modules");
  }
  if (fragment.externalEffects) {
    const next = mergeExternal(resolved.externalEffects, fragment.externalEffects);
    assertNoWiden("externalEffects", fragment, allowedWidening, actionPolicyWiden(resolved.externalEffects, next));
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
  allowedWidening: ReadonlySet<ScopePolicyArea>,
  widened: boolean,
): void {
  if (!widened || allowedWidening.has(area)) return;
  throw new ScopePolicyValidationError(
    `${fragment.scopeId} cannot widen ${area} beyond inherited policy without parent permission`,
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

function autonomyWiden(
  current: ResolvedScopePolicy["autonomy"],
  next: ResolvedScopePolicy["autonomy"],
): boolean {
  return autonomyRank(next.defaultMode) > autonomyRank(current.defaultMode) ||
    autonomyRank(next.maxMode) > autonomyRank(current.maxMode);
}

function autonomyRank(mode: ResolvedScopePolicy["autonomy"]["defaultMode"]): number {
  if (mode === "passive") return 0;
  if (mode === "supervised") return 1;
  return 2;
}

function writeBoundaryWiden(
  current: ScopeWriteBoundary,
  next: ScopeWriteBoundary,
  directoryRoot: string | undefined,
): boolean {
  if (current.mode === "unrestricted" || next.mode === "none") return false;
  if (next.mode === "unrestricted") return true;
  if (current.mode === "none") return writeBoundaryAllowsAnyPath(next, directoryRoot);

  if (next.mode === "scope-directory") {
    if (directoryRoot === undefined) return false;
    if (current.mode === "scope-directory") return false;
    return !writePathsCoverRoot(current.paths, directoryRoot, directoryRoot);
  }

  const nextPaths = resolveScopePolicyPaths(next.paths, directoryRoot);
  if (nextPaths.length === 0) return false;
  if (current.mode === "scope-directory") {
    return directoryRoot === undefined ||
      nextPaths.some((path) => !isScopePolicyPathWithin(directoryRoot, path));
  }

  const currentPaths = resolveScopePolicyPaths(current.paths, directoryRoot);
  return nextPaths.some((path) =>
    !currentPaths.some((currentPath) => isScopePolicyPathWithin(currentPath, path)),
  );
}

function writeBoundaryAllowsAnyPath(
  policy: ScopeWriteBoundary,
  directoryRoot: string | undefined,
): boolean {
  if (policy.mode === "none") return false;
  if (policy.mode === "unrestricted") return true;
  if (policy.mode === "scope-directory") return directoryRoot !== undefined;
  return resolveScopePolicyPaths(policy.paths, directoryRoot).length > 0;
}

function writePathsCoverRoot(
  paths: readonly string[],
  root: string,
  directoryRoot: string | undefined,
): boolean {
  return resolveScopePolicyPaths(paths, directoryRoot).some((path) =>
    isScopePolicyPathWithin(path, root),
  );
}

function setupRank(visibility: ScopeSetupVisibility): number {
  if (visibility === "hidden") return 0;
  if (visibility === "metadata") return 1;
  return 2;
}

function actionRank(policy: ScopeActionPolicy): number {
  if (policy === "deny") return 0;
  if (policy === "confirm") return 1;
  return 2;
}

function actionPolicyWiden<T extends Record<string, ScopeActionPolicy>>(
  current: T,
  next: T,
): boolean {
  return Object.keys(next).some((key) => actionRank(next[key]!) > actionRank(current[key]!));
}

function channelsWiden(
  current: ScopeChannelRoutingPolicy,
  next: ScopeChannelRoutingPolicy,
): boolean {
  const modeWidened = channelModeRank(next.mode) > channelModeRank(current.mode);
  const channelsWidened = current.mode === "allow-list" &&
    next.allowedChannels.some((channel) => !current.allowedChannels.includes(channel));
  const blockedRemoved = current.blockedSources.some((source) => !next.blockedSources.includes(source));
  const ignoredRemoved = current.ignoredSources.some((source) => !next.ignoredSources.includes(source));
  return modeWidened || channelsWidened || blockedRemoved || ignoredRemoved;
}

function channelModeRank(mode: ScopeChannelRoutingPolicy["mode"]): number {
  if (mode === "blocked") return 0;
  if (mode === "allow-list") return 1;
  return 2;
}

function retentionWiden(
  current: ScopeRetentionPolicy,
  next: ScopeRetentionPolicy,
): boolean {
  const ageWidened = current.mode === "expire-after-days" &&
    (next.mode === "retain" || next.maxAgeDays > current.maxAgeDays);
  return ageWidened || redactionRank(next.redaction) > redactionRank(current.redaction);
}

function redactionRank(profile: ScopeRedactionProfile): number {
  if (profile === "full") return 0;
  if (profile === "sensitive-fields") return 1;
  return 2;
}

function modulesWiden(
  current: ScopeModulePolicy,
  next: ScopeModulePolicy,
): boolean {
  if (availabilityRank(next.defaultAvailability) > availabilityRank(current.defaultAvailability)) {
    return true;
  }
  return next.overrides.some((entry) =>
    availabilityRank(entry.availability) > availabilityRank(moduleAvailability(current, entry.moduleName)),
  );
}

function moduleAvailability(
  policy: ScopeModulePolicy,
  moduleName: string,
): ScopeModuleAvailability {
  return policy.overrides.find((entry) => entry.moduleName === moduleName)?.availability ??
    policy.defaultAvailability;
}

function availabilityRank(value: ScopeModuleAvailability): number {
  if (value === "disabled") return 0;
  if (value === "setup-required") return 1;
  return 2;
}
