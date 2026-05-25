import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { QuietHoursConfig } from "../daemon/notification-gate.js";
import type { ModelTiers } from "../model/model-router.js";
import type { ForeignModuleConfig } from "../modules/foreign-module.js";
import type { AutonomyMode } from "../tools/autonomy-mode.js";
import type { GuardrailsConfig } from "../tools/guardrails.js";
import { mergeConfigs } from "./config-merge.js";
import { isPlainObject, sanitize } from "./config-sanitize.js";
import {
  getRegisteredConfigSlice,
  type KotaModuleConfigRegistry,
} from "./config-slice.js";

/**
 * KOTA configuration schema.
 *
 * Loaded from `~/.kota/config.json` (global) and trusted `.kota/config.json`
 * (project). Trusted project overrides global; CLI flags override both.
 *
 * Modules own their slice end-to-end via `KotaModule.configSlices`; this
 * type declares only the core-owned fields and intersects in module-
 * registered slice types via declaration merging on
 * `KotaModuleConfigRegistry`.
 */
export type CoreKotaConfig = {
  model?: string;
  editorModel?: string;
  maxTokens?: number;
  thinking?: boolean;
  thinkingBudget?: number;
  verbose?: boolean;
  skipConfirmations?: boolean;

  /**
   * Operator-owned project trust list. Only global config and explicit
   * overrides can grant trust to target project `.kota/config.json`; an
   * untrusted project cannot make itself trusted by setting this locally.
   * Entries must be absolute paths, with `~/` accepted for the operator home.
   */
  trustedProjects?: string[];

  /** Tool groups to auto-enable at session start (e.g. ["web", "code"]). */
  autoEnable?: string[];

  /** User profile — injected into system prompt for personalization. */
  user?: {
    name?: string;
    context?: string;
  };

  /** Prompt aliases — keys that expand into prefix text when starting a message. */
  aliases?: Record<string, string>;

  /** Self-reflection — evaluate response quality before delivering. Default: true. */
  reflection?: boolean;

  /** Guardrails — risk classification and policy enforcement for tool calls. */
  guardrails?: GuardrailsConfig;

  /** Per-module configuration. Keys are module names, values are module-specific settings. */
  modules?: Record<string, Record<string, unknown>>;

  /** Foreign-language (out-of-process) modules. */
  foreignModules?: ForeignModuleConfig[];

  /** Provider overrides. Keys are service types (e.g. "memory"), values are provider names. */
  providers?: Record<string, string>;

  /** Model tier mapping for adaptive routing. Keys: fast, balanced, capable. */
  modelTiers?: ModelTiers;

  /** Per-agent model overrides. */
  agentModels?: Record<string, string>;

  /**
   * Default agent harness adapter name. Must match a harness registered by a
   * loaded module. No implicit default — KOTA does not silently pick one.
   *
   * Operators that ship a preset rarely need to set this directly: the active
   * preset (`defaultPreset` / `--preset` / `KOTA_PRESET`) carries its own
   * harness. This field stays for the rare case where a workflow or operator
   * needs to pin a harness independently of the preset's harness.
   */
  defaultAgentHarness?: string;

  /**
   * Default preset id for this project. Selects harness + default model +
   * fast/balanced/capable tier mapping + default reasoning effort + auth
   * contract together. Resolution priority: `--preset` flag > `KOTA_PRESET`
   * env > this field > shipped default preset. Must match a shipped preset
   * id (`claude` | `codex` | `gemini` | `gemini-cli`). When unset, KOTA
   * selects the shipped default preset (`codex`).
   */
  defaultPreset?: string;

  /** TTL for pending approval items in milliseconds. Default: 86400000 (24 hours). */
  approvalTtlMs?: number;

  /** Run artifact retention policy for `.kota/runs/`. */
  runsGc?: {
    /** Delete runs older than this many days (default: 7). */
    retentionDays?: number;
    /** Always keep at least this many recent runs per workflow (default: 10). */
    minKeepPerWorkflow?: number;
  };

  /** HTTP server settings for `kota serve`. */
  serve?: {
    /** Disable bearer-token auth (default: auth enabled). For localhost-only dev use. */
    noAuth?: boolean;
    /** Show per-turn cost line in terminal output (default: true). */
    showCost?: boolean;
    /** Autonomy mode applied to new interactive sessions when the client does not specify one. */
    defaultAutonomyMode?: AutonomyMode;
  };

  /** CLI entrypoint settings (interactive REPL, `history resume`, piped input). */
  cli?: {
    /** Autonomy mode applied to CLI-launched sessions when no per-invocation override is provided. */
    defaultAutonomyMode?: AutonomyMode;
  };

  /** Log output settings. */
  log?: {
    /** "text" is human-readable (default); "json" emits newline-delimited JSON. */
    format?: "text" | "json";
  };

  /** Daemon lifecycle settings. */
  daemon?: {
    /** ms to wait for active workflow runs before aborting on shutdown. 0 = drain. */
    shutdownGracePeriodMs?: number;
    /** Recent SSE events retained in the in-memory ring buffer. Default: 500. */
    eventBufferSize?: number;
    /** Idle TTL for daemon-owned interactive chat sessions. Default: 5 min. */
    sessionIdleTtlMs?: number;
  };

  /** Notification settings. */
  notifications?: {
    /** Minimum ms between failure alerts for the same workflow. Default: 0. */
    alertCooldownMs?: number;
    /** Suppress non-critical channel notifications outside specified hours. */
    quietHours?: QuietHoursConfig;
  };

  /** Foreign module health monitoring settings. */
  moduleMonitoring?: {
    /** Restarts within `crashAlertWindowMs` that trigger `module.crash.alert`. */
    crashAlertThreshold?: number;
    /** Rolling window for counting module restarts. Also alert cooldown. */
    crashAlertWindowMs?: number;
  };

  /** Workflow runtime settings. */
  workflow?: {
    /** Max step output bytes before truncation. Default: 256 KB. Hard cap: 10 MB. */
    maxStepOutputBytes?: number;
  };
};

/**
 * Module-contributed config slice fields, derived from the
 * `KotaModuleConfigRegistry` declaration-merging surface in
 * `config-slice.ts`.
 */
export type ModuleConfigSliceFields = {
  [K in keyof KotaModuleConfigRegistry]?: KotaModuleConfigRegistry[K];
};

export type KotaConfig = CoreKotaConfig & ModuleConfigSliceFields;

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

/** Build a user profile string for system prompt injection. Returns empty string if no profile. */
export function buildUserProfile(config: KotaConfig): string {
  if (!config.user) return "";
  const parts: string[] = [];
  if (config.user.name) parts.push(`**User**: ${config.user.name}`);
  if (config.user.context) parts.push(config.user.context);
  if (parts.length === 0) return "";
  return `\n\n## User Profile\n\n${parts.join("\n")}`;
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

/** Expand aliases in a prompt. If prompt starts with an alias key, prepend the alias value. */
export function expandAlias(prompt: string, aliases?: Record<string, string>): string {
  if (!aliases) return prompt;
  for (const [key, expansion] of Object.entries(aliases)) {
    if (prompt.startsWith(`${key} `) || prompt === key) {
      const rest = prompt.slice(key.length).trimStart();
      return rest ? expansion + rest : expansion.trimEnd();
    }
  }
  return prompt;
}
