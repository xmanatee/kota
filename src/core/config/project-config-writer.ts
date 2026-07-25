import { lstatSync, realpathSync, type Stats } from "node:fs";
import { join } from "node:path";
import { isPlainObject } from "./config-sanitize.js";
import type { KotaConfig } from "./config-types.js";
import {
  type ConfigFileSnapshot,
  ensureAnchoredProjectConfigDirectory,
  type FileIdentity,
  readAnchoredProjectConfig,
  writeAnchoredProjectConfig,
} from "./project-config-directory-helper.js";

const PROJECT_CONFIG_DIRECTORY = ".kota";
const PROJECT_CONFIG_FILENAME = "config.json";
function projectConfigError(path: string, reason: string): Error {
  return new Error(`Refusing to update project config: ${path} ${reason}`);
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

/** Update project config through verified non-link filesystem objects. */
export function updateProjectConfig(
  cwd: string,
  update: (raw: Partial<KotaConfig>) => Partial<KotaConfig>,
): void {
  const projectRoot = realpathSync.native(cwd);
  const projectStats = lstatSync(projectRoot);
  if (!projectStats.isDirectory()) {
    throw projectConfigError(projectRoot, "must be a directory");
  }
  const projectRootIdentity = identity(projectStats);

  const configDir = join(projectRoot, PROJECT_CONFIG_DIRECTORY);
  let configDirectoryIdentity: FileIdentity;
  try {
    configDirectoryIdentity = ensureAnchoredProjectConfigDirectory(
      projectRoot,
      projectRootIdentity,
    );
  } catch (error) {
    throw projectConfigError(
      configDir,
      error instanceof Error ? error.message : "filesystem setup failed",
    );
  }
  let snapshot: ConfigFileSnapshot;
  try {
    snapshot = readAnchoredProjectConfig(
      projectRoot,
      projectRootIdentity,
      configDirectoryIdentity,
    );
  } catch (error) {
    throw projectConfigError(
      configDir,
      error instanceof Error ? error.message : "filesystem read failed",
    );
  }

  const existing = readExistingConfig(
    snapshot.exists ? snapshot.contents : undefined,
  );
  const serialized = `${JSON.stringify(update(existing), null, 2)}\n`;
  try {
    writeAnchoredProjectConfig(
      projectRoot,
      projectRootIdentity,
      configDirectoryIdentity,
      snapshot.exists ? snapshot.identity : null,
      serialized,
    );
  } catch (error) {
    throw projectConfigError(
      join(configDir, PROJECT_CONFIG_FILENAME),
      error instanceof Error ? error.message : "filesystem write failed",
    );
  }
}
