import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { loadConfig } from "#core/config/config.js";
import { isScopePolicyPathWithin } from "#core/daemon/scope-policy-paths.js";
import type { BrowserSessionIdentity } from "./browser-session-identity.js";
import {
  type BrowserNetworkProfile,
  resolveBrowserProfileConfig,
  resolveStorageStatePath,
} from "./config.js";

/** Configuration captured when a session-owned browser context is created. */
export type BrowserProfileOptions = {
  storageStatePath: string | null;
  persist: boolean;
  headless: boolean;
  networkProfile: BrowserNetworkProfile;
};

export type BrowserProfileOwner = {
  scopeId: string;
  scopeRoot: string;
};

export type BrowserProfileSnapshot = {
  profile: BrowserProfileOptions;
  profileOwner: BrowserProfileOwner;
};

/** Capture the invoking scope's trusted config, never the daemon's profile. */
export function snapshotConfiguredBrowserProfile(
  identity: BrowserProfileOwner,
  authorityConfigPath: string | undefined,
): BrowserProfileSnapshot {
  const config = loadConfig(identity.scopeRoot, undefined, {
    globalConfigPath: authorityConfigPath,
  });
  return {
    profile: resolveBrowserProfileConfig(config.modules?.browser),
    profileOwner: { ...identity },
  };
}

/**
 * Resolve existing symlinks before comparing profile ownership. For a profile
 * that does not exist yet, resolve its existing parent so persistence cannot
 * cross a scope boundary through a symlinked directory. Broken final symlinks
 * fail closed instead of becoming future persistence targets.
 */
function canonicalStoragePath(path: string): string | null {
  try {
    if (lstatSync(path).isSymbolicLink()) return null;
  } catch {
    // A missing final path is valid when its existing parent is stable.
  }
  try {
    return realpathSync(path);
  } catch {
    // Resolve a missing final path from its canonical parent below.
  }

  try {
    return resolve(realpathSync(dirname(path)), basename(path));
  } catch {
    return path;
  }
}

function canonicalWriteRoot(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function canonicalScopeRoot(scopeRoot: string): string {
  try {
    return realpathSync(scopeRoot);
  } catch {
    return resolve(scopeRoot);
  }
}

/**
 * Resolve a profile path for one invoking scope. Scope-local relative paths
 * are per-scope; absolute and escaping paths remain bound to their config owner.
 */
export function resolveBrowserProfileStoragePath(
  snapshot: BrowserProfileSnapshot,
  identity: BrowserSessionIdentity,
): string | null {
  const configuredPath = snapshot.profile.storageStatePath;
  if (!configuredPath) return null;
  const resolvedPath = resolveStorageStatePath(
    configuredPath,
    identity.scopeRoot,
  );
  if (!resolvedPath) return null;

  const canonicalPath = canonicalStoragePath(resolvedPath);
  if (!canonicalPath) return null;

  const projectRelativePath = relative(
    canonicalScopeRoot(identity.scopeRoot),
    canonicalPath,
  );
  const isExternalScope =
    isAbsolute(configuredPath) ||
    projectRelativePath === ".." ||
    projectRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(projectRelativePath);
  if (!isExternalScope) return canonicalPath;

  const owner = snapshot.profileOwner;
  return owner.scopeId === identity.scopeId &&
    owner.scopeRoot === identity.scopeRoot
    ? canonicalPath
    : null;
}

/** Recheck target identity and agent authority immediately before persistence. */
export function resolveBrowserProfilePersistencePath(
  snapshot: BrowserProfileSnapshot,
  identity: BrowserSessionIdentity,
  capturedPath: string | null,
  allowedWriteRoots: readonly string[] | undefined,
): string | null {
  const currentPath = resolveBrowserProfileStoragePath(snapshot, identity);
  if (currentPath !== capturedPath) {
    throw new Error(
      "Cannot persist browser profile: storage target changed during the session.",
    );
  }
  if (currentPath === null) return null;
  if (
    allowedWriteRoots !== undefined &&
    !allowedWriteRoots.some((root) =>
      isScopePolicyPathWithin(canonicalWriteRoot(root), currentPath)
    )
  ) {
    throw new Error(
      `Cannot persist browser profile outside the agent write scope: ${currentPath}`,
    );
  }
  return currentPath;
}
