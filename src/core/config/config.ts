import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { QuietHoursConfig } from "../daemon/notification-gate.js";
import type { ModelTiers } from "../model/model-router.js";
import type { ForeignModuleConfig } from "../modules/foreign-module.js";
import type { AutonomyMode } from "../tools/autonomy-mode.js";
import type { GuardrailsConfig } from "../tools/guardrails.js";
import { mergeConfigs } from "./config-merge.js";
import { isPlainObject, sanitize } from "./config-sanitize.js";
import type { KotaModuleConfigRegistry } from "./config-slice.js";

/**
 * KOTA configuration schema.
 *
 * Loaded from `~/.kota/config.json` (global) and `.kota/config.json`
 * (project). Project overrides global; CLI flags override both.
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
   * fast/balanced/capable tier mapping + default reasoning effort + required
   * env vars together. Resolution priority: `--preset` flag > `KOTA_PRESET`
   * env > this field > shipped default preset. Must match a shipped preset
   * id (`claude` | `codex` | `gemini`). When unset, KOTA selects the shipped
   * default preset (`claude`).
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

/**
 * Load configuration with layered precedence: global < project < overrides.
 * Overrides come from CLI flags or programmatic usage.
 */
export function loadConfig(
  cwd?: string,
  overrides?: Partial<KotaConfig>,
): KotaConfig {
  const projectDir = cwd || process.cwd();

  const globalConfig = readConfigFile(join(GLOBAL_DIR, CONFIG_FILENAME));
  const projectConfig = readConfigFile(join(projectDir, PROJECT_DIR, CONFIG_FILENAME));

  let config: Partial<KotaConfig> = {};

  if (globalConfig) config = mergeConfigs(config, sanitize(globalConfig));
  if (projectConfig) config = mergeConfigs(config, sanitize(projectConfig));
  if (overrides) config = mergeConfigs(config, sanitize(overrides));

  return config as KotaConfig;
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
