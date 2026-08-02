import { isScopePolicyPathWithin, resolveScopePolicyPaths } from "./scope-policy-paths.js";
import type {
  ResolvedScopePolicy,
  ScopeActionPolicy,
  ScopeModuleAvailability,
  ScopePolicyArea,
  ScopeRedactionProfile,
} from "./scope-policy-types.js";

export function scopePolicyWideningAreas(
  current: ResolvedScopePolicy,
  next: ResolvedScopePolicy,
): ScopePolicyArea[] {
  const widened: ScopePolicyArea[] = [];
  if (
    autonomyRank(next.autonomy.defaultMode) > autonomyRank(current.autonomy.defaultMode) ||
    autonomyRank(next.autonomy.maxMode) > autonomyRank(current.autonomy.maxMode)
  ) widened.push("autonomy");
  if (writesWiden(current, next)) widened.push("writes");
  if (channelsWiden(current, next)) widened.push("channels");
  if (setupRank(next.setup.visibility) > setupRank(current.setup.visibility)) widened.push("setup");
  if (actionMapWiden(current.ownerConfirmation, next.ownerConfirmation)) {
    widened.push("ownerConfirmation");
  }
  if (retentionWiden(current, next)) widened.push("retention");
  if (modulesWiden(current, next)) widened.push("modules");
  if (actionMapWiden(current.externalEffects, next.externalEffects)) {
    widened.push("externalEffects");
  }
  return widened;
}

function autonomyRank(mode: ResolvedScopePolicy["autonomy"]["defaultMode"]): number {
  if (mode === "passive") return 0;
  if (mode === "supervised") return 1;
  return 2;
}

function writesWiden(current: ResolvedScopePolicy, next: ResolvedScopePolicy): boolean {
  if (current.writes.mode === "unrestricted" || next.writes.mode === "none") return false;
  if (next.writes.mode === "unrestricted") return true;
  const root = next.directoryRoot;
  const currentPaths = allowedWritePaths(current);
  const nextPaths = allowedWritePaths(next);
  if (nextPaths.length === 0 && root === undefined) return false;
  return nextPaths.some((path) =>
    !currentPaths.some((currentPath) => isScopePolicyPathWithin(currentPath, path))
  );
}

function allowedWritePaths(policy: ResolvedScopePolicy): string[] {
  if (policy.writes.mode === "none") return [];
  if (policy.writes.mode === "unrestricted") return ["/"];
  if (policy.writes.mode === "scope-directory") {
    return policy.directoryRoot === undefined ? [] : [policy.directoryRoot];
  }
  return resolveScopePolicyPaths(policy.writes.paths, policy.directoryRoot);
}

function channelsWiden(current: ResolvedScopePolicy, next: ResolvedScopePolicy): boolean {
  if (channelRank(next.channels.mode) > channelRank(current.channels.mode)) return true;
  if (
    current.channels.mode === "allow-list" &&
    next.channels.allowedChannels.some((entry) => !current.channels.allowedChannels.includes(entry))
  ) return true;
  return current.channels.blockedSources.some((entry) => !next.channels.blockedSources.includes(entry)) ||
    current.channels.ignoredSources.some((entry) => !next.channels.ignoredSources.includes(entry));
}

function channelRank(mode: ResolvedScopePolicy["channels"]["mode"]): number {
  if (mode === "blocked") return 0;
  if (mode === "allow-list") return 1;
  return 2;
}

function setupRank(value: ResolvedScopePolicy["setup"]["visibility"]): number {
  if (value === "hidden") return 0;
  if (value === "metadata") return 1;
  return 2;
}

function actionMapWiden<T extends object>(current: T, next: T): boolean {
  for (const key of Object.keys(next) as Array<keyof T>) {
    const currentValue = current[key];
    const nextValue = next[key];
    if (
      typeof currentValue === "string" &&
      typeof nextValue === "string" &&
      actionRank(nextValue as ScopeActionPolicy) > actionRank(currentValue as ScopeActionPolicy)
    ) return true;
  }
  return false;
}

function actionRank(value: ScopeActionPolicy): number {
  if (value === "deny") return 0;
  if (value === "confirm") return 1;
  return 2;
}

function retentionWiden(current: ResolvedScopePolicy, next: ResolvedScopePolicy): boolean {
  const ageWidened = current.retention.mode === "expire-after-days" &&
    (next.retention.mode === "retain" || next.retention.maxAgeDays > current.retention.maxAgeDays);
  return ageWidened || redactionRank(next.retention.redaction) > redactionRank(current.retention.redaction);
}

function redactionRank(value: ScopeRedactionProfile): number {
  if (value === "full") return 0;
  if (value === "sensitive-fields") return 1;
  return 2;
}

function modulesWiden(current: ResolvedScopePolicy, next: ResolvedScopePolicy): boolean {
  if (
    availabilityRank(next.modules.defaultAvailability) >
    availabilityRank(current.modules.defaultAvailability)
  ) return true;
  return next.modules.overrides.some((entry) =>
    availabilityRank(entry.availability) >
    availabilityRank(moduleAvailability(current, entry.moduleName))
  );
}

function moduleAvailability(
  policy: ResolvedScopePolicy,
  moduleName: string,
): ScopeModuleAvailability {
  return policy.modules.overrides.find((entry) => entry.moduleName === moduleName)?.availability ??
    policy.modules.defaultAvailability;
}

function availabilityRank(value: ScopeModuleAvailability): number {
  if (value === "disabled") return 0;
  if (value === "setup-required") return 1;
  return 2;
}
