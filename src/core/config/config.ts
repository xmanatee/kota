import {
  existsSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deriveDirectoryScopeId } from "#core/daemon/scope-directory.js";
import { mergeConfigs } from "./config-merge.js";
import { isPlainObject, sanitize } from "./config-sanitize.js";
import { getRegisteredConfigSlice } from "./config-slice.js";
import type { KotaConfig } from "./config-types.js";

export { buildUserProfile, expandAlias } from "./config-text.js";
export type { CoreKotaConfig, KotaConfig, ModuleConfigSliceFields } from "./config-types.js";
export { updateProjectConfig } from "./project-config-writer.js";

const CONFIG_FILENAME = "config.json";
const GLOBAL_DIR = join(homedir(), ".kota");
const PROJECT_DIR = ".kota";
const MACHINE_AUTHORITY_KEYS = [
  "trustedProjects",
  "scopePolicies",
  "scopeAuthority",
] as const;

export type LoadConfigOptions = {
  globalConfigPath?: string;
};

export function getGlobalConfigPath(): string {
  return join(GLOBAL_DIR, CONFIG_FILENAME);
}

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
  ["scopePolicies", "scope policy authority"],
  ["scopeAuthority", "scope authority audit"],
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

export function normalizeProjectTrustPath(path: string): string {
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
  return normalizeProjectTrustPath(expanded);
}

function kotaSourceRoot(): string {
  return normalizeProjectTrustPath(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../.."),
  );
}

function isKotaSelfProject(projectDir: string): boolean {
  return normalizeProjectTrustPath(projectDir) === kotaSourceRoot();
}

function trustedProjectsIncludes(
  projectDir: string,
  config: Partial<KotaConfig>,
): boolean {
  const trustedProjects = config.trustedProjects ?? [];
  const normalizedProjectDir = normalizeProjectTrustPath(projectDir);
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
  const trustedPath = normalizeProjectTrustPath(projectDir);
  const scopeId = deriveDirectoryScopeId(trustedPath);
  const message =
    `ignored untrusted project config at ${path}; rejected key classes: ` +
    `${keyClasses.join("; ")}. Use ` +
    `"kota project authority set ${scopeId} --trust trusted --reason <reason>" ` +
    `from an interactive operator terminal with the live daemon to trust this project. ` +
    `Recovery source: ` +
    `${join(GLOBAL_DIR, CONFIG_FILENAME)} ("trustedProjects" includes "${trustedPath}").`;

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

/** Resolve project trust from persisted machine config, never caller overrides. */
export function loadProjectConfigTrustDecision(
  cwd?: string,
  options: LoadConfigOptions = {},
): ProjectConfigTrustDecision {
  const projectDir = cwd || process.cwd();
  const globalConfig = readConfigFile(options.globalConfigPath ?? getGlobalConfigPath());
  const authorityConfig = globalConfig ? sanitize(globalConfig) : {};
  return resolveProjectConfigTrust(projectDir, authorityConfig);
}

function stripMachineAuthority(
  config: Partial<KotaConfig>,
): Partial<KotaConfig> {
  const stripped = { ...config };
  for (const key of MACHINE_AUTHORITY_KEYS) delete stripped[key];
  return stripped;
}

/**
 * Load configuration with layered precedence: global < trusted project < overrides.
 * Machine authority is accepted only from the persisted global layer.
 */
export function loadConfigWithDiagnostics(
  cwd?: string,
  overrides?: Partial<KotaConfig>,
  options: LoadConfigOptions = {},
): LoadConfigResult {
  const projectDir = cwd || process.cwd();

  const globalConfig = readConfigFile(options.globalConfigPath ?? getGlobalConfigPath());
  const projectConfigPath = join(projectDir, PROJECT_DIR, CONFIG_FILENAME);
  const projectConfig = readConfigFile(projectConfigPath);
  const sanitizedGlobal = globalConfig ? sanitize(globalConfig) : {};
  const sanitizedOverrides = overrides
    ? sanitize(stripMachineAuthority(overrides))
    : undefined;
  const projectConfigTrust = resolveProjectConfigTrust(
    projectDir,
    sanitizedGlobal,
  );

  let config: Partial<KotaConfig> = {};

  if (globalConfig) config = mergeConfigs(config, sanitizedGlobal);
  const warnings: string[] = [];
  if (projectConfig) {
    if (projectConfigTrust.trusted) {
      const projectContent = { ...projectConfig };
      delete projectContent.trustedProjects;
      delete projectContent.scopePolicies;
      delete projectContent.scopeAuthority;
      config = mergeConfigs(config, sanitize(projectContent));
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
 * Machine authority is accepted only from the persisted global layer.
 */
export function loadConfig(
  cwd?: string,
  overrides?: Partial<KotaConfig>,
  options?: LoadConfigOptions,
): KotaConfig {
  return loadConfigWithDiagnostics(cwd, overrides, options).config;
}
