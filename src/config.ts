import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModelTiers } from "./core/model/model-router.js";
import type { ForeignModuleConfig } from "./core/modules/foreign-module.js";
import { type GuardrailsConfig, sanitizeGuardrailsConfig } from "./core/tools/guardrails.js";
import { type DispatchWindow, validateDispatchWindow } from "./core/workflow/dispatch-window.js";
import { type QuietHoursConfig, validateQuietHours } from "./modules/notifications/notification-gate.js";

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

  /** Per-module configuration. Keys are module names, values are module-specific settings. */
  modules?: Record<string, Record<string, unknown>>;

  /**
   * Foreign-language (out-of-process) modules.
   * Each entry declares a subprocess to spawn and communicate with via KEMP.
   * See `docs/FOREIGN-MODULES.md` for the protocol specification.
   */
  foreignModules?: ForeignModuleConfig[];

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
   * Per-agent model overrides. Keys are agent names (project or module-contributed);
   * values are model IDs. Takes effect at agent resolve time; invalid model strings are
   * passed through without validation, same as the top-level `model` field.
   */
  agentModels?: Record<string, string>;

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

  /** Budget warning settings. */
  budget?: {
    /**
     * Fraction of dailyBudgetUsd at which a one-time soft-limit warning notification fires.
     * Must be between 0 and 1 (exclusive). Example: 0.8 warns at 80% of the daily limit.
     * Omitting this field disables soft-limit warnings.
     */
    warnAt?: number;
  };

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
    /** Show per-turn cost line in terminal output (default: true). Set to false to suppress. */
    showCost?: boolean;
  };

  /** Log output settings. */
  log?: {
    /** Output format. "text" is human-readable (default); "json" emits newline-delimited JSON for log aggregators. Overridden by LOG_FORMAT env var. */
    format?: "text" | "json";
  };

  /** Daemon lifecycle settings. */
  daemon?: {
    /**
     * How long (ms) to wait for active workflow runs to complete before aborting them
     * during shutdown. 0 = drain indefinitely. Default: 60000 (60 s).
     */
    shutdownGracePeriodMs?: number;
    /**
     * Number of recent SSE events to retain in the in-memory ring buffer.
     * Clients can query buffered events via GET /api/events or replay them on
     * SSE reconnect with GET /events?since=<timestamp>. Default: 500.
     */
    eventBufferSize?: number;
    /**
     * How long (ms) a daemon-owned interactive chat session may be idle before
     * it is swept. Default: 300000 (5 minutes).
     */
    sessionIdleTtlMs?: number;
  };

  /** Notification settings. */
  notifications?: {
    /**
     * Minimum milliseconds between failure alerts for the same workflow.
     * Default: 0 (no cooldown — every failure fires an alert).
     * Example: 300000 suppresses repeated alerts within 5 minutes.
     */
    alertCooldownMs?: number;
    /**
     * Suppress non-critical channel notifications outside specified hours.
     * Events held during quiet hours are released as a single batched digest
     * when the window ends. workflow.failure.alert bypasses quiet hours by default.
     *
     * @example
     * { "start": "22:00", "end": "08:00", "allowCritical": true }
     */
    quietHours?: QuietHoursConfig;
  };

  /** Foreign module health monitoring settings. */
  moduleMonitoring?: {
    /**
     * Number of restarts within `crashAlertWindowMs` that triggers an
     * `module.crash.alert` notification. Default: 3.
     */
    crashAlertThreshold?: number;
    /**
     * Rolling window in milliseconds for counting module restarts.
     * Also serves as the alert cooldown — at most one alert per module per window.
     * Default: 600000 (10 minutes).
     */
    crashAlertWindowMs?: number;
  };

  /** Scheduler settings for autonomous workflow dispatch. */
  scheduler?: {
    /**
     * Restrict autonomous dispatch to a time-of-day window.
     * Affects `runtime.idle` (idle trigger) and `intervalMs` (interval trigger) only.
     * Cron, event, file-watch, and manual triggers are not affected.
     *
     * @example
     * { "start": "09:00", "end": "18:00", "days": ["mon","tue","wed","thu","fri"] }
     */
    dispatchWindow?: DispatchWindow;
    /**
     * Maximum number of agent-step workflows that may run simultaneously.
     * Must be a positive integer. Default: 1 (serial agent dispatch).
     */
    agentConcurrency?: number;
    /**
     * Maximum number of code-only (no agent step) workflows that may run
     * simultaneously. Must be a positive integer. Default: 4.
     */
    codeConcurrency?: number;
  };

  /** Workflow runtime settings. */
  workflow?: {
    /**
     * Maximum step output size in bytes before truncation.
     * Default: 262144 (256 KB). Hard cap: 10485760 (10 MB).
     * Outputs exceeding this limit are replaced with a structured truncation notice.
     */
    maxStepOutputBytes?: number;
  };

  /** MCP server settings. */
  mcp?: {
    /**
     * Sampling settings — allow MCP clients to delegate LLM completions to KOTA.
     * Default: disabled.
     */
    sampling?: {
      /** Enable the sampling/createMessage handler. Default: false. */
      enabled?: boolean;
    };
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

  if (typeof raw.modules === "object" && raw.modules !== null && !Array.isArray(raw.modules)) {
    const modules: Record<string, Record<string, unknown>> = {};
    for (const [name, val] of Object.entries(raw.modules)) {
      if (typeof val === "object" && val !== null && !Array.isArray(val)) {
        modules[name] = val as Record<string, unknown>;
      }
    }
    if (Object.keys(modules).length > 0) out.modules = modules;
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

  if (typeof raw.budget === "object" && raw.budget !== null && !Array.isArray(raw.budget)) {
    const src = raw.budget as Record<string, unknown>;
    const b: KotaConfig["budget"] = {};
    if (typeof src.warnAt === "number" && src.warnAt > 0 && src.warnAt < 1) b.warnAt = src.warnAt;
    if (Object.keys(b).length > 0) out.budget = b;
  }

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

  if (typeof raw.agentModels === "object" && raw.agentModels !== null && !Array.isArray(raw.agentModels)) {
    const agentModels: Record<string, string> = {};
    for (const [name, val] of Object.entries(raw.agentModels)) {
      if (typeof val === "string" && val) agentModels[name] = val;
    }
    if (Object.keys(agentModels).length > 0) out.agentModels = agentModels;
  }

  if (typeof raw.log === "object" && raw.log !== null && !Array.isArray(raw.log)) {
    const src = raw.log as Record<string, unknown>;
    if (src.format === "text" || src.format === "json") out.log = { format: src.format };
  }

  if (typeof raw.daemon === "object" && raw.daemon !== null && !Array.isArray(raw.daemon)) {
    const src = raw.daemon as Record<string, unknown>;
    const d: KotaConfig["daemon"] = {};
    if (typeof src.shutdownGracePeriodMs === "number" && src.shutdownGracePeriodMs >= 0) {
      d.shutdownGracePeriodMs = src.shutdownGracePeriodMs;
    }
    if (typeof src.eventBufferSize === "number" && src.eventBufferSize > 0) {
      d.eventBufferSize = src.eventBufferSize;
    }
    if (typeof src.sessionIdleTtlMs === "number" && src.sessionIdleTtlMs > 0) {
      d.sessionIdleTtlMs = src.sessionIdleTtlMs;
    }
    if (Object.keys(d).length > 0) out.daemon = d;
  }

  if (typeof raw.notifications === "object" && raw.notifications !== null && !Array.isArray(raw.notifications)) {
    const src = raw.notifications as Record<string, unknown>;
    const n: KotaConfig["notifications"] = {};
    if (typeof src.alertCooldownMs === "number" && src.alertCooldownMs >= 0) {
      n.alertCooldownMs = src.alertCooldownMs;
    }
    if (src.quietHours !== undefined && !validateQuietHours(src.quietHours)) {
      const qh = src.quietHours as Record<string, unknown>;
      const quietHours: QuietHoursConfig = {
        start: qh.start as string,
        end: qh.end as string,
      };
      if (typeof qh.allowCritical === "boolean") quietHours.allowCritical = qh.allowCritical;
      n.quietHours = quietHours;
    }
    if (Object.keys(n).length > 0) out.notifications = n;
  }

  if (typeof raw.scheduler === "object" && raw.scheduler !== null && !Array.isArray(raw.scheduler)) {
    const src = raw.scheduler as Record<string, unknown>;
    const s: KotaConfig["scheduler"] = {};
    if (src.dispatchWindow !== undefined) {
      const err = validateDispatchWindow(src.dispatchWindow);
      if (!err) {
        const dw = src.dispatchWindow as Record<string, unknown>;
        const window: DispatchWindow = {
          start: dw.start as string,
          end: dw.end as string,
        };
        if (Array.isArray(dw.days)) {
          window.days = dw.days as DispatchWindow["days"];
        }
        s.dispatchWindow = window;
      }
    }
    if (typeof src.agentConcurrency === "number" && src.agentConcurrency > 0 && Number.isInteger(src.agentConcurrency)) {
      s.agentConcurrency = src.agentConcurrency;
    }
    if (typeof src.codeConcurrency === "number" && src.codeConcurrency > 0 && Number.isInteger(src.codeConcurrency)) {
      s.codeConcurrency = src.codeConcurrency;
    }
    if (Object.keys(s).length > 0) out.scheduler = s;
  }

  if (typeof raw.workflow === "object" && raw.workflow !== null && !Array.isArray(raw.workflow)) {
    const src = raw.workflow as Record<string, unknown>;
    const w: KotaConfig["workflow"] = {};
    if (typeof src.maxStepOutputBytes === "number" && src.maxStepOutputBytes > 0) {
      w.maxStepOutputBytes = src.maxStepOutputBytes;
    }
    if (Object.keys(w).length > 0) out.workflow = w;
  }

  if (typeof raw.mcp === "object" && raw.mcp !== null && !Array.isArray(raw.mcp)) {
    const src = raw.mcp as Record<string, unknown>;
    const m: KotaConfig["mcp"] = {};
    if (typeof src.sampling === "object" && src.sampling !== null && !Array.isArray(src.sampling)) {
      const samp = src.sampling as Record<string, unknown>;
      const s: NonNullable<KotaConfig["mcp"]>["sampling"] = {};
      if (typeof samp.enabled === "boolean") s.enabled = samp.enabled;
      if (Object.keys(s).length > 0) m.sampling = s;
    }
    if (Object.keys(m).length > 0) out.mcp = m;
  }

  if (Array.isArray(raw.foreignModules)) {
    const fexts: ForeignModuleConfig[] = [];
    for (const entry of raw.foreignModules) {
      if (typeof entry !== "object" || entry === null) continue;
      const src = entry as Record<string, unknown>;
      if (src.transport === "http") {
        if (typeof src.url !== "string" || !src.url) continue;
        fexts.push({ transport: "http", url: src.url });
        continue;
      }
      if (src.transport !== "stdio") continue;
      if (typeof src.command !== "string" || !src.command) continue;
      const fext: ForeignModuleConfig = { transport: "stdio", command: src.command };
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
    if (fexts.length > 0) out.foreignModules = fexts;
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
    } else if (key === "modules" && typeof val === "object") {
      merged.modules = { ...a.modules, ...(val as Record<string, Record<string, unknown>>) };
    } else if (key === "providers" && typeof val === "object") {
      merged.providers = { ...a.providers, ...(val as Record<string, string>) };
    } else if (key === "modelProvider" && typeof val === "object") {
      merged.modelProvider = { ...a.modelProvider, ...(val as KotaConfig["modelProvider"]) };
    } else if (key === "modelTiers" && typeof val === "object") {
      merged.modelTiers = { ...a.modelTiers, ...(val as ModelTiers) };
    } else if (key === "agentModels" && typeof val === "object") {
      merged.agentModels = { ...a.agentModels, ...(val as Record<string, string>) };
    } else if (key === "runsGc" && typeof val === "object") {
      merged.runsGc = { ...a.runsGc, ...(val as KotaConfig["runsGc"]) };
    } else if (key === "webhooks" && typeof val === "object") {
      merged.webhooks = { ...a.webhooks, ...(val as Record<string, { secret: string }>) };
    } else if (key === "autoEnable" && Array.isArray(val)) {
      // Project autoEnable replaces global (not merges) — project knows best
      merged.autoEnable = val as string[];
    } else if (key === "foreignModules" && Array.isArray(val)) {
      // Project foreign modules append to global
      merged.foreignModules = [...(a.foreignModules ?? []), ...(val as ForeignModuleConfig[])];
    } else if (key === "budget" && typeof val === "object") {
      merged.budget = { ...a.budget, ...(val as KotaConfig["budget"]) };
    } else if (key === "notifications" && typeof val === "object") {
      merged.notifications = { ...a.notifications, ...(val as KotaConfig["notifications"]) };
    } else if (key === "scheduler" && typeof val === "object") {
      merged.scheduler = { ...a.scheduler, ...(val as KotaConfig["scheduler"]) };
    } else if (key === "workflow" && typeof val === "object") {
      merged.workflow = { ...a.workflow, ...(val as KotaConfig["workflow"]) };
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
