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
export { updateScopeConfig } from "./scope-config-writer.js";

const CONFIG_FILENAME = "config.json";
const GLOBAL_DIR = join(homedir(), ".kota");
const SCOPE_DIR = ".kota";
const MACHINE_AUTHORITY_KEYS = [
  "trustedScopes",
  "scopePolicies",
  "scopeAuthority",
] as const;

export type LoadConfigOptions = {
  globalConfigPath?: string;
};

export function getGlobalConfigPath(): string {
  return join(GLOBAL_DIR, CONFIG_FILENAME);
}

export type ScopeConfigTrustReason =
  | "kota-self-scope"
  | "trusted-scopes-config"
  | "untrusted";

export type IgnoredScopeConfig = {
  path: string;
  keys: string[];
  keyClasses: string[];
  message: string;
};

export type ScopeConfigTrustDecision = {
  trusted: boolean;
  reason: ScopeConfigTrustReason;
  scopeRoot: string;
  scopeConfigPath: string;
  ignored?: IgnoredScopeConfig;
};

export type LoadConfigResult = {
  config: KotaConfig;
  scopeConfigTrust: ScopeConfigTrustDecision;
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

export function normalizeScopeTrustPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function normalizeTrustedScopeEntry(entry: string): string | null {
  const expanded = entry.startsWith("~/")
    ? join(homedir(), entry.slice(2))
    : entry;
  if (!isAbsolute(expanded)) return null;
  return normalizeScopeTrustPath(expanded);
}

function kotaSourceRoot(): string {
  return normalizeScopeTrustPath(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../.."),
  );
}

function isKotaSelfScope(scopeRoot: string): boolean {
  return normalizeScopeTrustPath(scopeRoot) === kotaSourceRoot();
}

function trustedScopesIncludes(
  scopeRoot: string,
  config: Partial<KotaConfig>,
): boolean {
  const trustedScopes = config.trustedScopes ?? [];
  const normalizedScopeRoot = normalizeScopeTrustPath(scopeRoot);
  return trustedScopes.some((entry) =>
    normalizeTrustedScopeEntry(entry) === normalizedScopeRoot
  );
}

function classifyScopeConfigKey(
  key: string,
  rawScopeConfig: NonNullable<ReturnType<typeof readConfigFile>>,
): string {
  const direct = AUTHORITY_KEY_CLASSES.get(key);
  if (direct) return direct;
  const slice = getRegisteredConfigSlice(key);
  if (slice?.scopeConfigSafety === "authority") return "module config";
  if (slice?.scopeConfigSafety === "safe") return "safe module config";
  if (key === "trustedScopes") return "scope trust";
  if (key === "daemon" || key === "workflow") return "runtime posture";
  if (key === "cli") return "operator CLI posture";
  if (key === "notifications" || key === "moduleMonitoring") return "operator notification/runtime posture";
  if (key === "autoEnable") return "tool enablement";
  if (key === "log") return "operator logging";
  if (key === "approvalTtlMs") return "approval policy";
  if (key === "user" || key === "aliases" || key === "reflection") return "prompt/session behavior";
  if (rawScopeConfig[key] !== undefined) return "scope config";
  return "scope config";
}

function summarizeIgnoredScopeConfig(
  scopeRoot: string,
  path: string,
  rawScopeConfig: NonNullable<ReturnType<typeof readConfigFile>>,
): IgnoredScopeConfig | undefined {
  const keys = Object.keys(rawScopeConfig).sort();
  if (keys.length === 0) return undefined;

  const byClass = new Map<string, string[]>();
  for (const key of keys) {
    const keyClass = classifyScopeConfigKey(key, rawScopeConfig);
    const existing = byClass.get(keyClass) ?? [];
    existing.push(key);
    byClass.set(keyClass, existing);
  }
  const keyClasses = [...byClass.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([keyClass, classKeys]) => `${keyClass} (${classKeys.join(", ")})`);
  const trustedPath = normalizeScopeTrustPath(scopeRoot);
  const scopeId = deriveDirectoryScopeId(trustedPath);
  const message =
    `ignored untrusted scope config at ${path}; rejected key classes: ` +
    `${keyClasses.join("; ")}. Use ` +
    `"kota scope authority set ${scopeId} --trust trusted --reason <reason>" ` +
    `from an interactive operator terminal with the live daemon to trust this scope. ` +
    `Recovery source: ` +
    `${join(GLOBAL_DIR, CONFIG_FILENAME)} ("trustedScopes" includes "${trustedPath}").`;

  return { path, keys, keyClasses, message };
}

export function resolveScopeConfigTrust(
  scopeRoot: string,
  authorityConfig: Partial<KotaConfig> = {},
): ScopeConfigTrustDecision {
  const scopeConfigPath = join(scopeRoot, SCOPE_DIR, CONFIG_FILENAME);
  if (isKotaSelfScope(scopeRoot)) {
    return {
      trusted: true,
      reason: "kota-self-scope",
      scopeRoot,
      scopeConfigPath,
    };
  }
  if (trustedScopesIncludes(scopeRoot, authorityConfig)) {
    return {
      trusted: true,
      reason: "trusted-scopes-config",
      scopeRoot,
      scopeConfigPath,
    };
  }
  return {
    trusted: false,
    reason: "untrusted",
    scopeRoot,
    scopeConfigPath,
  };
}

/** Resolve scope trust from persisted machine config, never caller overrides. */
export function loadScopeConfigTrustDecision(
  cwd?: string,
  options: LoadConfigOptions = {},
): ScopeConfigTrustDecision {
  const scopeRoot = cwd || process.cwd();
  const globalConfig = readConfigFile(options.globalConfigPath ?? getGlobalConfigPath());
  const authorityConfig = globalConfig ? sanitize(globalConfig) : {};
  return resolveScopeConfigTrust(scopeRoot, authorityConfig);
}

function stripMachineAuthority(
  config: Partial<KotaConfig>,
): Partial<KotaConfig> {
  const stripped = { ...config };
  for (const key of MACHINE_AUTHORITY_KEYS) delete stripped[key];
  return stripped;
}

/**
 * Load configuration with layered precedence: global < trusted scope < overrides.
 * Machine authority is accepted only from the persisted global layer.
 */
export function loadConfigWithDiagnostics(
  cwd?: string,
  overrides?: Partial<KotaConfig>,
  options: LoadConfigOptions = {},
): LoadConfigResult {
  const scopeRoot = cwd || process.cwd();

  const globalConfig = readConfigFile(options.globalConfigPath ?? getGlobalConfigPath());
  const scopeConfigPath = join(scopeRoot, SCOPE_DIR, CONFIG_FILENAME);
  const scopeConfig = readConfigFile(scopeConfigPath);
  const sanitizedGlobal = globalConfig ? sanitize(globalConfig) : {};
  const sanitizedOverrides = overrides
    ? sanitize(stripMachineAuthority(overrides))
    : undefined;
  const scopeConfigTrust = resolveScopeConfigTrust(
    scopeRoot,
    sanitizedGlobal,
  );

  let config: Partial<KotaConfig> = {};

  if (globalConfig) config = mergeConfigs(config, sanitizedGlobal);
  const warnings: string[] = [];
  if (scopeConfig) {
    if (scopeConfigTrust.trusted) {
      const scopeContent = { ...scopeConfig };
      delete scopeContent.trustedScopes;
      delete scopeContent.scopePolicies;
      delete scopeContent.scopeAuthority;
      config = mergeConfigs(config, sanitize(scopeContent));
    } else {
      const ignored = summarizeIgnoredScopeConfig(
        scopeRoot,
        scopeConfigPath,
        scopeConfig,
      );
      if (ignored) {
        scopeConfigTrust.ignored = ignored;
        warnings.push(ignored.message);
      }
    }
  }
  if (sanitizedOverrides) config = mergeConfigs(config, sanitizedOverrides);

  return {
    config: config as KotaConfig,
    scopeConfigTrust,
    warnings,
  };
}

/**
 * Load configuration with layered precedence: global < trusted scope < overrides.
 * Machine authority is accepted only from the persisted global layer.
 */
export function loadConfig(
  cwd?: string,
  overrides?: Partial<KotaConfig>,
  options?: LoadConfigOptions,
): KotaConfig {
  return loadConfigWithDiagnostics(cwd, overrides, options).config;
}
