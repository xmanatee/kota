import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { BrowserSessionIdentity } from "./browser-session-identity.js";
import {
  type BrowserNetworkProfile,
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
  projectDir: string;
};

export type BrowserProfileSnapshot = {
  profile: BrowserProfileOptions;
  profileOwner: BrowserProfileOwner | null;
};

let profile: BrowserProfileOptions = {
  storageStatePath: null,
  persist: false,
  headless: true,
  networkProfile: { name: "public-untrusted" },
};
let profileOwner: BrowserProfileOwner | null = null;

/** Configure the profile used by subsequently-created session contexts. */
export function configureBrowserProfile(
  options: BrowserProfileOptions,
  owner: BrowserProfileOwner,
): void {
  profile = options;
  profileOwner = {
    scopeId: owner.scopeId,
    projectDir: resolve(owner.projectDir),
  };
}

export function getConfiguredBrowserProfile(): BrowserProfileOptions {
  return profile;
}

export function snapshotConfiguredBrowserProfile(): BrowserProfileSnapshot {
  return { profile, profileOwner };
}

/**
 * Resolve existing symlinks before comparing profile ownership. For a profile
 * that does not exist yet, resolve its existing parent so persistence cannot
 * cross a scope boundary through a symlinked directory. Broken final symlinks
 * fail closed instead of becoming future persistence targets.
 */
function canonicalStoragePath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    try {
      if (lstatSync(path).isSymbolicLink()) return null;
    } catch {
      // A missing final path is valid for an operator capturing a new profile.
    }
  }

  try {
    return resolve(realpathSync(dirname(path)), basename(path));
  } catch {
    return path;
  }
}

function canonicalProjectDir(projectDir: string): string {
  try {
    return realpathSync(projectDir);
  } catch {
    return resolve(projectDir);
  }
}

/**
 * Resolve a profile path for one invoking scope. Project-local relative paths
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
    identity.projectDir,
  );
  if (!resolvedPath) return null;

  const canonicalPath = canonicalStoragePath(resolvedPath);
  if (!canonicalPath) return null;

  const projectRelativePath = relative(
    canonicalProjectDir(identity.projectDir),
    canonicalPath,
  );
  const isProjectExternal =
    isAbsolute(configuredPath) ||
    projectRelativePath === ".." ||
    projectRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(projectRelativePath);
  if (!isProjectExternal) return canonicalPath;

  const owner = snapshot.profileOwner;
  return owner?.scopeId === identity.scopeId &&
    owner.projectDir === identity.projectDir
    ? canonicalPath
    : null;
}
