/**
 * Core-field sanitization for KOTA config.
 *
 * Module-owned slices are sanitized in their own modules; this file owns
 * the canonical sanitize pass for fields declared on `CoreKotaConfig`.
 */

import { parseQuietHours } from "../daemon/notification-gate.js";
import type { ModelTiers } from "../model/model-router.js";
import type { ForeignModuleConfig } from "../modules/foreign-module.js";
import { type AutonomyMode, isAutonomyMode } from "../tools/autonomy-mode.js";
import { sanitizeGuardrailsConfig } from "../tools/guardrails.js";
import type { CoreKotaConfig, KotaConfig } from "./config.js";
import {
  getRegisteredConfigSlices,
  type KotaModuleConfigRegistry,
} from "./config-slice.js";

/** Validate and coerce config values for core-owned fields. */
export function sanitizeCore(raw: unknown): Partial<CoreKotaConfig> {
  const out: Partial<CoreKotaConfig> = {};
  if (!isPlainObject(raw)) return out;

  if (typeof raw.model === "string" && raw.model) out.model = raw.model;
  if (typeof raw.editorModel === "string" && raw.editorModel) out.editorModel = raw.editorModel;
  if (typeof raw.maxTokens === "number" && raw.maxTokens > 0) out.maxTokens = raw.maxTokens;
  if (typeof raw.thinking === "boolean") out.thinking = raw.thinking;
  if (typeof raw.thinkingBudget === "number" && raw.thinkingBudget >= 1024) out.thinkingBudget = raw.thinkingBudget;
  if (typeof raw.verbose === "boolean") out.verbose = raw.verbose;
  if (typeof raw.skipConfirmations === "boolean") out.skipConfirmations = raw.skipConfirmations;
  if (typeof raw.reflection === "boolean") out.reflection = raw.reflection;
  if (typeof raw.defaultAgentHarness === "string" && raw.defaultAgentHarness) {
    out.defaultAgentHarness = raw.defaultAgentHarness;
  }

  if (Array.isArray(raw.autoEnable)) {
    const valid = raw.autoEnable.filter((g): g is string => typeof g === "string" && g.length > 0);
    if (valid.length > 0) out.autoEnable = valid;
  }

  if (isPlainObject(raw.user)) {
    const user: NonNullable<CoreKotaConfig["user"]> = {};
    if (typeof raw.user.name === "string" && raw.user.name) user.name = raw.user.name;
    if (typeof raw.user.context === "string" && raw.user.context) user.context = raw.user.context;
    if (user.name || user.context) out.user = user;
  }

  if (isPlainObject(raw.aliases)) {
    const aliases: Record<string, string> = {};
    for (const [key, val] of Object.entries(raw.aliases)) {
      if (typeof val === "string" && val) aliases[key] = val;
    }
    if (Object.keys(aliases).length > 0) out.aliases = aliases;
  }

  if (isPlainObject(raw.guardrails)) {
    const parsed = sanitizeGuardrailsConfig(raw.guardrails);
    if (parsed) out.guardrails = parsed;
  }

  if (isPlainObject(raw.modules)) {
    const modules: Record<string, Record<string, unknown>> = {};
    for (const [name, val] of Object.entries(raw.modules)) {
      if (isPlainObject(val)) modules[name] = val;
    }
    if (Object.keys(modules).length > 0) out.modules = modules;
  }

  if (isPlainObject(raw.providers)) {
    const providers: Record<string, string> = {};
    for (const [type, name] of Object.entries(raw.providers)) {
      if (typeof name === "string" && name) providers[type] = name;
    }
    if (Object.keys(providers).length > 0) out.providers = providers;
  }

  if (typeof raw.approvalTtlMs === "number" && raw.approvalTtlMs > 0) out.approvalTtlMs = raw.approvalTtlMs;

  if (isPlainObject(raw.runsGc)) {
    const gc: NonNullable<CoreKotaConfig["runsGc"]> = {};
    if (typeof raw.runsGc.retentionDays === "number" && raw.runsGc.retentionDays > 0) gc.retentionDays = raw.runsGc.retentionDays;
    if (typeof raw.runsGc.minKeepPerWorkflow === "number" && raw.runsGc.minKeepPerWorkflow >= 0) gc.minKeepPerWorkflow = raw.runsGc.minKeepPerWorkflow;
    out.runsGc = gc;
  }

  if (isPlainObject(raw.modelTiers)) {
    const tiers: ModelTiers = {};
    if (typeof raw.modelTiers.fast === "string" && raw.modelTiers.fast) tiers.fast = raw.modelTiers.fast;
    if (typeof raw.modelTiers.balanced === "string" && raw.modelTiers.balanced) tiers.balanced = raw.modelTiers.balanced;
    if (typeof raw.modelTiers.capable === "string" && raw.modelTiers.capable) tiers.capable = raw.modelTiers.capable;
    if (tiers.fast || tiers.balanced || tiers.capable) out.modelTiers = tiers;
  }

  if (isPlainObject(raw.agentModels)) {
    const agentModels: Record<string, string> = {};
    for (const [name, val] of Object.entries(raw.agentModels)) {
      if (typeof val === "string" && val) agentModels[name] = val;
    }
    if (Object.keys(agentModels).length > 0) out.agentModels = agentModels;
  }

  if (isPlainObject(raw.log)) {
    if (raw.log.format === "text" || raw.log.format === "json") out.log = { format: raw.log.format };
  }

  sanitizeServe(out, raw.serve);
  sanitizeCli(out, raw.cli);
  sanitizeDaemon(out, raw.daemon);
  sanitizeNotifications(out, raw.notifications);
  sanitizeWorkflow(out, raw.workflow);
  sanitizeModuleMonitoring(out, raw.moduleMonitoring);

  if (Array.isArray(raw.foreignModules)) {
    const fexts = sanitizeForeignModules(raw.foreignModules);
    if (fexts.length > 0) out.foreignModules = fexts;
  }

  return out;
}

/** Sanitize: walk core fields, then registered module slices. */
export function sanitize(raw: unknown): Partial<KotaConfig> {
  const out = sanitizeCore(raw) as Partial<KotaConfig>;
  if (!isPlainObject(raw)) return out;
  for (const slice of getRegisteredConfigSlices()) {
    const rawSlice = raw[slice.key];
    if (rawSlice === undefined) continue;
    const sanitized = slice.sanitize(rawSlice);
    if (sanitized !== undefined) {
      (out as Record<string, KotaModuleConfigRegistry[keyof KotaModuleConfigRegistry]>)[slice.key] =
        sanitized as KotaModuleConfigRegistry[keyof KotaModuleConfigRegistry];
    }
  }
  return out;
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sanitizeServe(out: Partial<CoreKotaConfig>, src: unknown): void {
  if (!isPlainObject(src)) return;
  const s: NonNullable<CoreKotaConfig["serve"]> = {};
  if (typeof src.noAuth === "boolean") s.noAuth = src.noAuth;
  if (typeof src.showCost === "boolean") s.showCost = src.showCost;
  if (src.defaultAutonomyMode !== undefined) {
    s.defaultAutonomyMode = expectAutonomyMode(src.defaultAutonomyMode, "config.serve.defaultAutonomyMode");
  }
  if (Object.keys(s).length > 0) out.serve = s;
}

function sanitizeCli(out: Partial<CoreKotaConfig>, src: unknown): void {
  if (!isPlainObject(src)) return;
  const c: NonNullable<CoreKotaConfig["cli"]> = {};
  if (src.defaultAutonomyMode !== undefined) {
    c.defaultAutonomyMode = expectAutonomyMode(src.defaultAutonomyMode, "config.cli.defaultAutonomyMode");
  }
  if (Object.keys(c).length > 0) out.cli = c;
}

function sanitizeDaemon(out: Partial<CoreKotaConfig>, src: unknown): void {
  if (!isPlainObject(src)) return;
  const d: NonNullable<CoreKotaConfig["daemon"]> = {};
  if (typeof src.shutdownGracePeriodMs === "number" && src.shutdownGracePeriodMs >= 0) d.shutdownGracePeriodMs = src.shutdownGracePeriodMs;
  if (typeof src.eventBufferSize === "number" && src.eventBufferSize > 0) d.eventBufferSize = src.eventBufferSize;
  if (typeof src.sessionIdleTtlMs === "number" && src.sessionIdleTtlMs > 0) d.sessionIdleTtlMs = src.sessionIdleTtlMs;
  if (Object.keys(d).length > 0) out.daemon = d;
}

function sanitizeNotifications(out: Partial<CoreKotaConfig>, src: unknown): void {
  if (!isPlainObject(src)) return;
  const n: NonNullable<CoreKotaConfig["notifications"]> = {};
  if (typeof src.alertCooldownMs === "number" && src.alertCooldownMs >= 0) n.alertCooldownMs = src.alertCooldownMs;
  if (src.quietHours !== undefined) {
    const parsed = parseQuietHours(src.quietHours);
    if (parsed.ok) n.quietHours = parsed.config;
  }
  if (Object.keys(n).length > 0) out.notifications = n;
}

function sanitizeWorkflow(out: Partial<CoreKotaConfig>, src: unknown): void {
  if (!isPlainObject(src)) return;
  const w: NonNullable<CoreKotaConfig["workflow"]> = {};
  if (typeof src.maxStepOutputBytes === "number" && src.maxStepOutputBytes > 0) w.maxStepOutputBytes = src.maxStepOutputBytes;
  if (Object.keys(w).length > 0) out.workflow = w;
}

function sanitizeModuleMonitoring(
  out: Partial<CoreKotaConfig>,
  src: unknown,
): void {
  if (!isPlainObject(src)) return;
  const mm: NonNullable<CoreKotaConfig["moduleMonitoring"]> = {};
  if (typeof src.crashAlertThreshold === "number" && src.crashAlertThreshold > 0 && Number.isInteger(src.crashAlertThreshold)) mm.crashAlertThreshold = src.crashAlertThreshold;
  if (typeof src.crashAlertWindowMs === "number" && src.crashAlertWindowMs > 0) mm.crashAlertWindowMs = src.crashAlertWindowMs;
  if (Object.keys(mm).length > 0) out.moduleMonitoring = mm;
}

function expectAutonomyMode(value: unknown, errorPath: string): AutonomyMode {
  if (!isAutonomyMode(value)) {
    throw new Error(
      `${errorPath} must be one of passive, supervised, autonomous (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

function sanitizeForeignModules(entries: unknown[]): ForeignModuleConfig[] {
  const fexts: ForeignModuleConfig[] = [];
  for (const entry of entries) {
    if (!isPlainObject(entry)) continue;
    if (entry.transport === "http") {
      if (typeof entry.url !== "string" || !entry.url) continue;
      fexts.push({ transport: "http", url: entry.url });
      continue;
    }
    if (entry.transport !== "stdio") continue;
    if (typeof entry.command !== "string" || !entry.command) continue;
    const fext: ForeignModuleConfig = { transport: "stdio", command: entry.command };
    if (Array.isArray(entry.args)) fext.args = entry.args.filter((a): a is string => typeof a === "string");
    if (isPlainObject(entry.env)) {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(entry.env)) {
        if (typeof v === "string") env[k] = v;
      }
      if (Object.keys(env).length > 0) fext.env = env;
    }
    if (typeof entry.cwd === "string" && entry.cwd) fext.cwd = entry.cwd;
    fexts.push(fext);
  }
  return fexts;
}
