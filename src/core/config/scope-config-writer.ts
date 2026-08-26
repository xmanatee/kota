import { lstatSync, realpathSync, type Stats } from "node:fs";
import { join } from "node:path";
import { isPlainObject } from "./config-sanitize.js";
import type { KotaConfig } from "./config-types.js";
import {
  type ConfigFileSnapshot,
  ensureAnchoredScopeConfigDirectory,
  type FileIdentity,
  readAnchoredScopeConfig,
  writeAnchoredScopeConfig,
} from "./scope-config-directory-helper.js";

const SCOPE_CONFIG_DIRECTORY = ".kota";
const SCOPE_CONFIG_FILENAME = "config.json";
function scopeConfigError(path: string, reason: string): Error {
  return new Error(`Refusing to update scope config: ${path} ${reason}`);
}

function identity(stats: Stats): FileIdentity {
  return { dev: stats.dev, ino: stats.ino };
}

function readExistingConfig(
  contents: string | undefined,
): Partial<KotaConfig> {
  if (contents === undefined) return {};
  try {
    const parsed = JSON.parse(contents);
    return isPlainObject(parsed) ? parsed as Partial<KotaConfig> : {};
  } catch (error) {
    if (error instanceof SyntaxError) return {};
    throw error;
  }
}

/** Update scope config through verified non-link filesystem objects. */
export function updateScopeConfig(
  cwd: string,
  update: (raw: Partial<KotaConfig>) => Partial<KotaConfig>,
): void {
  const scopeRoot = realpathSync.native(cwd);
  const scopeStats = lstatSync(scopeRoot);
  if (!scopeStats.isDirectory()) {
    throw scopeConfigError(scopeRoot, "must be a directory");
  }
  const scopeRootIdentity = identity(scopeStats);

  const configDir = join(scopeRoot, SCOPE_CONFIG_DIRECTORY);
  let configDirectoryIdentity: FileIdentity;
  try {
    configDirectoryIdentity = ensureAnchoredScopeConfigDirectory(
      scopeRoot,
      scopeRootIdentity,
    );
  } catch (error) {
    throw scopeConfigError(
      configDir,
      error instanceof Error ? error.message : "filesystem setup failed",
    );
  }
  let snapshot: ConfigFileSnapshot;
  try {
    snapshot = readAnchoredScopeConfig(
      scopeRoot,
      scopeRootIdentity,
      configDirectoryIdentity,
    );
  } catch (error) {
    throw scopeConfigError(
      configDir,
      error instanceof Error ? error.message : "filesystem read failed",
    );
  }

  const existing = readExistingConfig(
    snapshot.exists ? snapshot.contents : undefined,
  );
  const serialized = `${JSON.stringify(update(existing), null, 2)}\n`;
  try {
    writeAnchoredScopeConfig(
      scopeRoot,
      scopeRootIdentity,
      configDirectoryIdentity,
      snapshot.exists ? snapshot.identity : null,
      serialized,
    );
  } catch (error) {
    throw scopeConfigError(
      join(configDir, SCOPE_CONFIG_FILENAME),
      error instanceof Error ? error.message : "filesystem write failed",
    );
  }
}
