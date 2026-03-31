import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ForeignExtensionConfig } from "./foreign-extension.js";
import { type GuardrailsConfig, sanitizeGuardrailsConfig } from "./guardrails.js";
import type { ModelTiers } from "./model/model-router.js";

/**
 * KOTA configuration schema.
 * Loaded from ~/.kota/config.json (global) and .kota/config.json (project).
 * Project-level overrides global. CLI flags override both.
 */
export type KotaConfig = {
  model?: string;
  editorModel?: string;
  maxTokens?: number;
  architect?: boolean;
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

  /** Per-extension configuration. Keys are extension names, values are extension-specific settings. */
  extensions?: Record<string, Record<string, unknown>>;

  /**
   * Foreign-language (out-of-process) extensions.
   * Each entry declares a subprocess to spawn and communicate with via KEMP.
   * See `docs/FOREIGN-EXTENSIONS.md` for the protocol specification.
   */
  foreignExtensions?: ForeignExtensionConfig[];

  /** Provider overrides. Keys are service types (e.g. "memory", "knowledge"), values are provider names. */
  providers?: Record<string, string>;

  /** Model provider configuration for non-Anthropic backends (OpenAI-compat, Ollama, etc.). */
  modelProvider?: {
    type?: string;
    baseUrl?: string;
    apiKey?: string;
  };

  /** Model tier mapping for adaptive routing. Keys: fast, balanced, capable. */
  modelTiers?: ModelTiers;

  /**
   * Per-workflow webhook secrets for `POST /webhooks/:workflowName`.
   * Keys are workflow names; each entry must have a `secret` string.
   * Keep this in `.kota/config.json` (project-local, gitignored) to avoid
   * committing secrets.
   */
  webhooks?: Record<string, { secret: string }>;

  /** TTL for pending approval items in milliseconds. Default: 86400000 (24 hours). */
  approvalTtlMs?: number;

  /** Maximum API spend per calendar day (UTC). Workflow dispatch pauses when exceeded. */
  dailyBudgetUsd?: number;

  /**
   * Run artifact retention policy for `.kota/runs/`.
   * Applied when `kota workflow gc` is run explicitly.
   * Defaults: retentionDays=7, minKeepPerWorkflow=10.
   */
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
  };

  /** Daemon lifecycle settings. */
  daemon?: {
    /**
     * How long (ms) to wait for active workflow runs to complete before aborting them
     * during shutdown. 0 = drain indefinitely. Default: 60000 (60 s).
     */
    shutdownGracePeriodMs?: number;
  };
};

const CONFIG_FILENAME = "config.json";
const GLOBAL_DIR = join(homedir(), ".kota");
const PROJECT_DIR = ".kota";

/** Read and parse a JSON config file. Returns null if missing or invalid. */
function readConfigFile(path: string): Partial<KotaConfig> | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Partial<KotaConfig>;
  } catch {
    return null;
  }
}

/** Validate and coerce config values. Returns a clean config with only known fields. */
function sanitize(raw: Partial<KotaConfig>): Partial<KotaConfig> {
  const out: Partial<KotaConfig> = {};

  if (typeof raw.model === "string" && raw.model) out.model = raw.model;
  if (typeof raw.editorModel === "string" && raw.editorModel) out.editorModel = raw.editorModel;
  if (typeof raw.maxTokens === "number" && raw.maxTokens > 0) out.maxTokens = raw.maxTokens;
  if (typeof raw.architect === "boolean") out.architect = raw.architect;
  if (typeof raw.thinking === "boolean") out.thinking = raw.thinking;
  if (typeof raw.thinkingBudget === "number" && raw.thinkingBudget >= 1024) out.thinkingBudget = raw.thinkingBudget;
  if (typeof raw.verbose === "boolean") out.verbose = raw.verbose;
  if (typeof raw.skipConfirmations === "boolean") out.skipConfirmations = raw.skipConfirmations;
  if (typeof raw.reflection === "boolean") out.reflection = raw.reflection;

  if (Array.isArray(raw.autoEnable)) {
    const valid = raw.autoEnable.filter((g): g is string => typeof g === "string" && g.length > 0);
    if (valid.length > 0) out.autoEnable = valid;
  }

  if (typeof raw.user === "object" && raw.user !== null && !Array.isArray(raw.user)) {
    const user: KotaConfig["user"] = {};
    if (typeof raw.user.name === "string" && raw.user.name) user.name = raw.user.name;
    if (typeof raw.user.context === "string" && raw.user.context) user.context = raw.user.context;
    if (user.name || user.context) out.user = user;
  }

  if (typeof raw.aliases === "object" && raw.aliases !== null && !Array.isArray(raw.aliases)) {
    const aliases: Record<string, string> = {};
    for (const [key, val] of Object.entries(raw.aliases)) {
      if (typeof val === "string" && val) aliases[key] = val;
    }
    if (Object.keys(aliases).length > 0) out.aliases = aliases;
  }

  if (typeof raw.guardrails === "object" && raw.guardrails !== null && !Array.isArray(raw.guardrails)) {
    const parsed = sanitizeGuardrailsConfig(raw.guardrails as Record<string, unknown>);
    if (parsed) out.guardrails = parsed;
  }

  if (typeof raw.extensions === "object" && raw.extensions !== null && !Array.isArray(raw.extensions)) {
    const extensions: Record<string, Record<string, unknown>> = {};
    for (const [name, val] of Object.entries(raw.extensions)) {
      if (typeof val === "object" && val !== null && !Array.isArray(val)) {
        extensions[name] = val as Record<string, unknown>;
      }
    }
    if (Object.keys(extensions).length > 0) out.extensions = extensions;
  }

  if (typeof raw.providers === "object" && raw.providers !== null && !Array.isArray(raw.providers)) {
    const providers: Record<string, string> = {};
    for (const [type, name] of Object.entries(raw.providers)) {
      if (typeof name === "string" && name) providers[type] = name;
    }
    if (Object.keys(providers).length > 0) out.providers = providers;
  }

  if (typeof raw.modelProvider === "object" && raw.modelProvider !== null && !Array.isArray(raw.modelProvider)) {
    const mp: KotaConfig["modelProvider"] = {};
    const src = raw.modelProvider as Record<string, unknown>;
    if (typeof src.type === "string" && src.type) mp.type = src.type;
    if (typeof src.baseUrl === "string" && src.baseUrl) mp.baseUrl = src.baseUrl;
    if (typeof src.apiKey === "string" && src.apiKey) mp.apiKey = src.apiKey;
    if (mp.type || mp.baseUrl) out.modelProvider = mp;
  }

  if (typeof raw.webhooks === "object" && raw.webhooks !== null && !Array.isArray(raw.webhooks)) {
    const webhooks: Record<string, { secret: string }> = {};
    for (const [name, val] of Object.entries(raw.webhooks)) {
      if (typeof val === "object" && val !== null && !Array.isArray(val)) {
        const entry = val as Record<string, unknown>;
        if (typeof entry.secret === "string" && entry.secret) {
          webhooks[name] = { secret: entry.secret };
        }
      }
    }
    if (Object.keys(webhooks).length > 0) out.webhooks = webhooks;
  }

  if (typeof raw.approvalTtlMs === "number" && raw.approvalTtlMs > 0) out.approvalTtlMs = raw.approvalTtlMs;
  if (typeof raw.dailyBudgetUsd === "number" && raw.dailyBudgetUsd > 0) out.dailyBudgetUsd = raw.dailyBudgetUsd;

  if (typeof raw.runsGc === "object" && raw.runsGc !== null && !Array.isArray(raw.runsGc)) {
    const gc: KotaConfig["runsGc"] = {};
    const src = raw.runsGc as Record<string, unknown>;
    if (typeof src.retentionDays === "number" && src.retentionDays > 0) gc.retentionDays = src.retentionDays;
    if (typeof src.minKeepPerWorkflow === "number" && src.minKeepPerWorkflow >= 0) gc.minKeepPerWorkflow = src.minKeepPerWorkflow;
    out.runsGc = gc;
  }

  if (typeof raw.modelTiers === "object" && raw.modelTiers !== null && !Array.isArray(raw.modelTiers)) {
    const tiers: ModelTiers = {};
    const src = raw.modelTiers as Record<string, unknown>;
    if (typeof src.fast === "string" && src.fast) tiers.fast = src.fast;
    if (typeof src.balanced === "string" && src.balanced) tiers.balanced = src.balanced;
    if (typeof src.capable === "string" && src.capable) tiers.capable = src.capable;
    if (tiers.fast || tiers.balanced || tiers.capable) out.modelTiers = tiers;
  }

  if (typeof raw.daemon === "object" && raw.daemon !== null && !Array.isArray(raw.daemon)) {
    const src = raw.daemon as Record<string, unknown>;
    const d: KotaConfig["daemon"] = {};
    if (typeof src.shutdownGracePeriodMs === "number" && src.shutdownGracePeriodMs >= 0) {
      d.shutdownGracePeriodMs = src.shutdownGracePeriodMs;
    }
    if (Object.keys(d).length > 0) out.daemon = d;
  }

  if (Array.isArray(raw.foreignExtensions)) {
    const fexts: ForeignExtensionConfig[] = [];
    for (const entry of raw.foreignExtensions) {
      if (typeof entry !== "object" || entry === null) continue;
      const src = entry as Record<string, unknown>;
      if (src.transport !== "stdio") continue;
      if (typeof src.command !== "string" || !src.command) continue;
      const fext: ForeignExtensionConfig = { transport: "stdio", command: src.command };
      if (Array.isArray(src.args)) {
        fext.args = src.args.filter((a): a is string => typeof a === "string");
      }
      if (typeof src.env === "object" && src.env !== null && !Array.isArray(src.env)) {
        const env: Record<string, string> = {};
        for (const [k, v] of Object.entries(src.env as Record<string, unknown>)) {
          if (typeof v === "string") env[k] = v;
        }
        if (Object.keys(env).length > 0) fext.env = env;
      }
      if (typeof src.cwd === "string" && src.cwd) fext.cwd = src.cwd;
      fexts.push(fext);
    }
    if (fexts.length > 0) out.foreignExtensions = fexts;
  }

  return out;
}

/** Deep-merge two configs. `b` overrides `a` for scalar fields; arrays/objects merge shallowly. */
function mergeConfigs(a: Partial<KotaConfig>, b: Partial<KotaConfig>): Partial<KotaConfig> {
  const merged = { ...a };

  for (const key of Object.keys(b) as (keyof KotaConfig)[]) {
    const val = b[key];
    if (val === undefined) continue;

    if (key === "user" && typeof val === "object") {
      merged.user = { ...a.user, ...val };
    } else if (key === "aliases" && typeof val === "object") {
      merged.aliases = { ...a.aliases, ...(val as Record<string, string>) };
    } else if (key === "guardrails" && typeof val === "object") {
      // Project guardrails override global — merge policies, project toolOverrides replace global
      const base = a.guardrails;
      const over = val as GuardrailsConfig;
      merged.guardrails = {
        policies: { ...(base?.policies), ...over.policies },
        toolOverrides: over.toolOverrides ?? base?.toolOverrides,
      };
    } else if (key === "extensions" && typeof val === "object") {
      merged.extensions = { ...a.extensions, ...(val as Record<string, Record<string, unknown>>) };
    } else if (key === "providers" && typeof val === "object") {
      merged.providers = { ...a.providers, ...(val as Record<string, string>) };
    } else if (key === "modelProvider" && typeof val === "object") {
      merged.modelProvider = { ...a.modelProvider, ...(val as KotaConfig["modelProvider"]) };
    } else if (key === "modelTiers" && typeof val === "object") {
      merged.modelTiers = { ...a.modelTiers, ...(val as ModelTiers) };
    } else if (key === "runsGc" && typeof val === "object") {
      merged.runsGc = { ...a.runsGc, ...(val as KotaConfig["runsGc"]) };
    } else if (key === "webhooks" && typeof val === "object") {
      merged.webhooks = { ...a.webhooks, ...(val as Record<string, { secret: string }>) };
    } else if (key === "autoEnable" && Array.isArray(val)) {
      // Project autoEnable replaces global (not merges) — project knows best
      merged.autoEnable = val as string[];
    } else if (key === "foreignExtensions" && Array.isArray(val)) {
      // Project foreign extensions append to global
      merged.foreignExtensions = [...(a.foreignExtensions ?? []), ...(val as ForeignExtensionConfig[])];
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (merged as any)[key] = val;
    }
  }

  return merged;
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
 * Update the project-local `.kota/config.json` by applying a mutation function to the raw
 * (unsanitized) config object. Creates the file and directory if they do not exist.
 */
export function updateProjectConfig(
  cwd: string,
  update: (raw: Partial<KotaConfig>) => Partial<KotaConfig>,
): void {
  const configDir = join(cwd, PROJECT_DIR);
  const configPath = join(configDir, CONFIG_FILENAME);
  const existing = readConfigFile(configPath) ?? {};
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
