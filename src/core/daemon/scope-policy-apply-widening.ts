import { isScopePolicyPathWithin, resolveScopePolicyPaths } from "./scope-policy-paths.js";
import type {
  ResolvedScopePolicy,
  ScopeActionPolicy,
  ScopeChannelRoutingPolicy,
  ScopeModuleAvailability,
  ScopeModulePolicy,
  ScopeRedactionProfile,
  ScopeRetentionPolicy,
  ScopeSetupVisibility,
  ScopeWriteBoundary,
} from "./scope-policy-types.js";

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

export function setupRank(visibility: ScopeSetupVisibility): number {
  if (visibility === "hidden") return 0;
  if (visibility === "metadata") return 1;
  return 2;
}

function actionRank(policy: ScopeActionPolicy): number {
  if (policy === "deny") return 0;
  if (policy === "confirm") return 1;
  return 2;
}

export function actionPolicyWiden<T extends Record<string, ScopeActionPolicy>>(
  current: T,
  next: T,
): boolean {
  return Object.keys(next).some((key) => actionRank(next[key]!) > actionRank(current[key]!));
}

export function channelsWiden(
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

export function retentionWiden(
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

export function modulesWiden(current: ScopeModulePolicy, next: ScopeModulePolicy): boolean {
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
