import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeConfigs } from "./config-merge.js";
import { isPlainObject, sanitize } from "./config-sanitize.js";
import { getRegisteredConfigSlice } from "./config-slice.js";
import type { KotaConfig } from "./config-types.js";

export { buildUserProfile, expandAlias } from "./config-text.js";
export type { CoreKotaConfig, KotaConfig, ModuleConfigSliceFields } from "./config-types.js";

const CONFIG_FILENAME = "config.json";
const GLOBAL_DIR = join(homedir(), ".kota");
const PROJECT_DIR = ".kota";

export type ProjectConfigTrustReason =
  | "kota-self-project"
  | "trusted-projects-config"
  | "untrusted";

export type IgnoredProjectConfig = {
  path: string;
  keys: string[];
  keyClasses: string[];
  message: string;
};

export type ProjectConfigTrustDecision = {
  trusted: boolean;
  reason: ProjectConfigTrustReason;
  projectDir: string;
  projectConfigPath: string;
  ignored?: IgnoredProjectConfig;
};

export type LoadConfigResult = {
  config: KotaConfig;
  projectConfigTrust: ProjectConfigTrustDecision;
  warnings: string[];
};

const AUTHORITY_KEY_CLASSES: ReadonlyMap<string, string> = new Map([
  ["guardrails", "guardrail policy"],
  ["skipConfirmations", "confirmation policy"],
  ["defaultAgentHarness", "harness/preset selection"],
  ["defaultPreset", "harness/preset selection"],
  ["model", "model/provider routing"],
  ["editorModel", "model/provider routing"],
  ["modelTiers", "model/provider routing"],
  ["modelOutputTokenLimits", "model/provider routing"],
  ["agentModels", "model/provider routing"],
  ["providers", "model/provider routing"],
  ["foreignModules", "foreign module launch"],
  ["modules", "module config"],
  ["serve", "server/auth posture"],
]);

/** Read and parse a JSON config file. Returns null if missing or invalid. */
function readConfigFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizePathForTrust(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function normalizeTrustedProjectEntry(entry: string): string | null {
  const expanded = entry.startsWith("~/")
    ? join(homedir(), entry.slice(2))
    : entry;
  if (!isAbsolute(expanded)) return null;
  return normalizePathForTrust(expanded);
}

function kotaSourceRoot(): string {
  return normalizePathForTrust(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../.."),
  );
}

function isKotaSelfProject(projectDir: string): boolean {
  return normalizePathForTrust(projectDir) === kotaSourceRoot();
}

function trustedProjectsIncludes(
  projectDir: string,
  config: Partial<KotaConfig>,
): boolean {
  const trustedProjects = config.trustedProjects ?? [];
  const normalizedProjectDir = normalizePathForTrust(projectDir);
  return trustedProjects.some((entry) =>
    normalizeTrustedProjectEntry(entry) === normalizedProjectDir
  );
}

function classifyProjectConfigKey(
  key: string,
  rawProjectConfig: NonNullable<ReturnType<typeof readConfigFile>>,
): string {
  const direct = AUTHORITY_KEY_CLASSES.get(key);
  if (direct) return direct;
  const slice = getRegisteredConfigSlice(key);
  if (slice?.projectConfigSafety === "authority") return "module config";
  if (slice?.projectConfigSafety === "safe") return "safe module config";
  if (key === "trustedProjects") return "project trust";
  if (key === "daemon" || key === "workflow") return "runtime posture";
  if (key === "cli") return "operator CLI posture";
  if (key === "notifications" || key === "moduleMonitoring") return "operator notification/runtime posture";
  if (key === "autoEnable") return "tool enablement";
  if (key === "log") return "operator logging";
  if (key === "approvalTtlMs") return "approval policy";
  if (key === "user" || key === "aliases" || key === "reflection") return "prompt/session behavior";
  if (rawProjectConfig[key] !== undefined) return "project config";
  return "project config";
}

function summarizeIgnoredProjectConfig(
  projectDir: string,
  path: string,
  rawProjectConfig: NonNullable<ReturnType<typeof readConfigFile>>,
): IgnoredProjectConfig | undefined {
  const keys = Object.keys(rawProjectConfig).sort();
  if (keys.length === 0) return undefined;

  const byClass = new Map<string, string[]>();
  for (const key of keys) {
    const keyClass = classifyProjectConfigKey(key, rawProjectConfig);
    const existing = byClass.get(keyClass) ?? [];
    existing.push(key);
    byClass.set(keyClass, existing);
  }
  const keyClasses = [...byClass.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([keyClass, classKeys]) => `${keyClass} (${classKeys.join(", ")})`);
  const trustedPath = normalizePathForTrust(projectDir);
  const message =
    `ignored untrusted project config at ${path}; rejected key classes: ` +
    `${keyClasses.join("; ")}. Add "${trustedPath}" to "trustedProjects" ` +
    `in ${join(GLOBAL_DIR, CONFIG_FILENAME)} to trust this project.`;

  return { path, keys, keyClasses, message };
}

export function resolveProjectConfigTrust(
  projectDir: string,
  authorityConfig: Partial<KotaConfig> = {},
): ProjectConfigTrustDecision {
  const projectConfigPath = join(projectDir, PROJECT_DIR, CONFIG_FILENAME);
  if (isKotaSelfProject(projectDir)) {
    return {
      trusted: true,
      reason: "kota-self-project",
      projectDir,
      projectConfigPath,
    };
  }
  if (trustedProjectsIncludes(projectDir, authorityConfig)) {
    return {
      trusted: true,
      reason: "trusted-projects-config",
      projectDir,
      projectConfigPath,
    };
  }
  return {
    trusted: false,
    reason: "untrusted",
    projectDir,
    projectConfigPath,
  };
}

/**
 * Load configuration with layered precedence: global < trusted project < overrides.
 * Overrides come from CLI flags or programmatic usage.
 */
export function loadConfigWithDiagnostics(
  cwd?: string,
  overrides?: Partial<KotaConfig>,
): LoadConfigResult {
  const projectDir = cwd || process.cwd();

  const globalConfig = readConfigFile(join(GLOBAL_DIR, CONFIG_FILENAME));
  const projectConfigPath = join(projectDir, PROJECT_DIR, CONFIG_FILENAME);
  const projectConfig = readConfigFile(projectConfigPath);
  const sanitizedGlobal = globalConfig ? sanitize(globalConfig) : {};
  const sanitizedOverrides = overrides ? sanitize(overrides) : undefined;
  const trustAuthorityConfig = sanitizedOverrides
    ? mergeConfigs(sanitizedGlobal, sanitizedOverrides)
    : sanitizedGlobal;
  const projectConfigTrust = resolveProjectConfigTrust(
    projectDir,
    trustAuthorityConfig,
  );

  let config: Partial<KotaConfig> = {};

  if (globalConfig) config = mergeConfigs(config, sanitizedGlobal);
  const warnings: string[] = [];
  if (projectConfig) {
    if (projectConfigTrust.trusted) {
      config = mergeConfigs(config, sanitize(projectConfig));
    } else {
      const ignored = summarizeIgnoredProjectConfig(
        projectDir,
        projectConfigPath,
        projectConfig,
      );
      if (ignored) {
        projectConfigTrust.ignored = ignored;
        warnings.push(ignored.message);
      }
    }
  }
  if (sanitizedOverrides) config = mergeConfigs(config, sanitizedOverrides);

  return {
    config: config as KotaConfig,
    projectConfigTrust,
    warnings,
  };
}

/**
 * Load configuration with layered precedence: global < trusted project < overrides.
 * Overrides come from CLI flags or programmatic usage.
 */
export function loadConfig(
  cwd?: string,
  overrides?: Partial<KotaConfig>,
): KotaConfig {
  return loadConfigWithDiagnostics(cwd, overrides).config;
}

/**
 * Update the project-local `.kota/config.json` by applying a mutation
 * function to the raw (unsanitized) config object. Creates the file and
 * directory if they do not exist.
 */
export function updateProjectConfig(
  cwd: string,
  update: (raw: Partial<KotaConfig>) => Partial<KotaConfig>,
): void {
  const configDir = join(cwd, PROJECT_DIR);
  const configPath = join(configDir, CONFIG_FILENAME);
  const existing = (readConfigFile(configPath) ?? {}) as Partial<KotaConfig>;
  const updated = update(existing);
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(updated, null, 2)}\n`, "utf-8");
}
