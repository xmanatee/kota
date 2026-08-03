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
  ScopeRedactionProfile,
  ScopeRetentionPolicy,
  ScopeSetupVisibility,
  ScopeWriteBoundary,
} from "./scope-policy-types.js";

export function scopePolicyWideningAreas(
  current: ResolvedScopePolicy,
  next: ResolvedScopePolicy,
): ScopePolicyArea[] {
  const widened: ScopePolicyArea[] = [];
  if (autonomyWiden(current.autonomy, next.autonomy)) widened.push("autonomy");
  if (writeBoundaryWiden(current.writes, next.writes, next.directoryRoot)) {
    widened.push("writes");
  }
  if (channelsWiden(current.channels, next.channels)) widened.push("channels");
  if (setupRank(next.setup.visibility) > setupRank(current.setup.visibility)) widened.push("setup");
  if (ownerConfirmationWiden(current.ownerConfirmation, next.ownerConfirmation)) {
    widened.push("ownerConfirmation");
  }
  if (retentionWiden(current.retention, next.retention)) widened.push("retention");
  if (modulesWiden(current.modules, next.modules)) widened.push("modules");
  if (externalEffectsWiden(current.externalEffects, next.externalEffects)) {
    widened.push("externalEffects");
  }
  return widened;
}

export function scopePolicyRestrictiveAreas(
  current: ResolvedScopePolicy,
  next: ResolvedScopePolicy,
): ScopePolicyArea[] {
  return scopePolicyWideningAreas(next, current);
}

export function autonomyWiden(
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

export function writeBoundaryWiden(
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
    !currentPaths.some((currentPath) => isScopePolicyPathWithin(currentPath, path))
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
    isScopePolicyPathWithin(path, root)
  );
}

export function channelsWiden(
  current: ScopeChannelRoutingPolicy,
  next: ScopeChannelRoutingPolicy,
): boolean {
  const modeWidened = channelRank(next.mode) > channelRank(current.mode);
  const channelsWidened = current.mode === "allow-list" &&
    next.allowedChannels.some((channel) => !current.allowedChannels.includes(channel));
  const blockedRemoved = current.blockedSources.some((source) =>
    !next.blockedSources.includes(source)
  );
  const ignoredRemoved = current.ignoredSources.some((source) =>
    !next.ignoredSources.includes(source)
  );
  return modeWidened || channelsWidened || blockedRemoved || ignoredRemoved;
}

function channelRank(mode: ScopeChannelRoutingPolicy["mode"]): number {
  if (mode === "blocked") return 0;
  if (mode === "allow-list") return 1;
  return 2;
}

export function setupRank(value: ScopeSetupVisibility): number {
  if (value === "hidden") return 0;
  if (value === "metadata") return 1;
  return 2;
}

export function ownerConfirmationWiden(
  current: ScopeOwnerConfirmationPolicy,
  next: ScopeOwnerConfirmationPolicy,
): boolean {
  return actionWiden(current.localWrite, next.localWrite) ||
    actionWiden(current.externalWrite, next.externalWrite) ||
    actionWiden(current.destructive, next.destructive);
}

export function externalEffectsWiden(
  current: ScopeExternalEffectPolicy,
  next: ScopeExternalEffectPolicy,
): boolean {
  return actionWiden(current.networkRead, next.networkRead) ||
    actionWiden(current.networkWrite, next.networkWrite) ||
    actionWiden(current.networkDestructive, next.networkDestructive);
}

function actionWiden(current: ScopeActionPolicy, next: ScopeActionPolicy): boolean {
  return actionRank(next) > actionRank(current);
}

function actionRank(value: ScopeActionPolicy): number {
  if (value === "deny") return 0;
  if (value === "confirm") return 1;
  return 2;
}

export function retentionWiden(
  current: ScopeRetentionPolicy,
  next: ScopeRetentionPolicy,
): boolean {
  const ageWidened = current.mode === "expire-after-days" &&
    (next.mode === "retain" || next.maxAgeDays > current.maxAgeDays);
  return ageWidened || redactionRank(next.redaction) > redactionRank(current.redaction);
}

function redactionRank(value: ScopeRedactionProfile): number {
  if (value === "full") return 0;
  if (value === "sensitive-fields") return 1;
  return 2;
}

export function modulesWiden(current: ScopeModulePolicy, next: ScopeModulePolicy): boolean {
  if (
    availabilityRank(next.defaultAvailability) >
    availabilityRank(current.defaultAvailability)
  ) return true;
  const moduleNames = new Set([
    ...current.overrides.map((entry) => entry.moduleName),
    ...next.overrides.map((entry) => entry.moduleName),
  ]);
  return [...moduleNames].some((moduleName) =>
    availabilityRank(moduleAvailability(next, moduleName)) >
    availabilityRank(moduleAvailability(current, moduleName))
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
