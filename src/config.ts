import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
    } else if (key === "autoEnable" && Array.isArray(val)) {
      // Project autoEnable replaces global (not merges) — project knows best
      merged.autoEnable = val as string[];
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
