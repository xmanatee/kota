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
export function sanitizeCore(raw: Partial<KotaConfig>): Partial<CoreKotaConfig> {
  const out: Partial<CoreKotaConfig> = {};

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
    const parsed = sanitizeGuardrailsConfig(raw.guardrails as Record<string, unknown>);
    if (parsed) out.guardrails = parsed;
  }

  if (isPlainObject(raw.modules)) {
    const modules: Record<string, Record<string, unknown>> = {};
    for (const [name, val] of Object.entries(raw.modules)) {
      if (isPlainObject(val)) modules[name] = val as Record<string, unknown>;
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
    const src = raw.runsGc as Record<string, unknown>;
    if (typeof src.retentionDays === "number" && src.retentionDays > 0) gc.retentionDays = src.retentionDays;
    if (typeof src.minKeepPerWorkflow === "number" && src.minKeepPerWorkflow >= 0) gc.minKeepPerWorkflow = src.minKeepPerWorkflow;
    out.runsGc = gc;
  }

  if (isPlainObject(raw.modelTiers)) {
    const tiers: ModelTiers = {};
    const src = raw.modelTiers as Record<string, unknown>;
    if (typeof src.fast === "string" && src.fast) tiers.fast = src.fast;
    if (typeof src.balanced === "string" && src.balanced) tiers.balanced = src.balanced;
    if (typeof src.capable === "string" && src.capable) tiers.capable = src.capable;
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
    const src = raw.log as Record<string, unknown>;
    if (src.format === "text" || src.format === "json") out.log = { format: src.format };
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
export function sanitize(raw: Partial<KotaConfig>): Partial<KotaConfig> {
  const out = sanitizeCore(raw) as Partial<KotaConfig>;
  for (const slice of getRegisteredConfigSlices()) {
    const rawSlice = (raw as Record<string, unknown>)[slice.key];
    if (rawSlice === undefined) continue;
    const sanitized = slice.sanitize(rawSlice);
    if (sanitized !== undefined) {
      (out as Record<string, unknown>)[slice.key] =
        sanitized as KotaModuleConfigRegistry[keyof KotaModuleConfigRegistry];
    }
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sanitizeServe(out: Partial<CoreKotaConfig>, src: KotaConfig["serve"]): void {
  if (!isPlainObject(src)) return;
  const obj = src as Record<string, unknown>;
  const s: NonNullable<CoreKotaConfig["serve"]> = {};
  if (typeof obj.noAuth === "boolean") s.noAuth = obj.noAuth;
  if (typeof obj.showCost === "boolean") s.showCost = obj.showCost;
  if (obj.defaultAutonomyMode !== undefined) {
    s.defaultAutonomyMode = expectAutonomyMode(obj.defaultAutonomyMode, "config.serve.defaultAutonomyMode");
  }
  if (Object.keys(s).length > 0) out.serve = s;
}

function sanitizeCli(out: Partial<CoreKotaConfig>, src: KotaConfig["cli"]): void {
  if (!isPlainObject(src)) return;
  const obj = src as Record<string, unknown>;
  const c: NonNullable<CoreKotaConfig["cli"]> = {};
  if (obj.defaultAutonomyMode !== undefined) {
    c.defaultAutonomyMode = expectAutonomyMode(obj.defaultAutonomyMode, "config.cli.defaultAutonomyMode");
  }
  if (Object.keys(c).length > 0) out.cli = c;
}

function sanitizeDaemon(out: Partial<CoreKotaConfig>, src: KotaConfig["daemon"]): void {
  if (!isPlainObject(src)) return;
  const obj = src as Record<string, unknown>;
  const d: NonNullable<CoreKotaConfig["daemon"]> = {};
  if (typeof obj.shutdownGracePeriodMs === "number" && obj.shutdownGracePeriodMs >= 0) d.shutdownGracePeriodMs = obj.shutdownGracePeriodMs;
  if (typeof obj.eventBufferSize === "number" && obj.eventBufferSize > 0) d.eventBufferSize = obj.eventBufferSize;
  if (typeof obj.sessionIdleTtlMs === "number" && obj.sessionIdleTtlMs > 0) d.sessionIdleTtlMs = obj.sessionIdleTtlMs;
  if (Object.keys(d).length > 0) out.daemon = d;
}

function sanitizeNotifications(out: Partial<CoreKotaConfig>, src: KotaConfig["notifications"]): void {
  if (!isPlainObject(src)) return;
  const obj = src as Record<string, unknown>;
  const n: NonNullable<CoreKotaConfig["notifications"]> = {};
  if (typeof obj.alertCooldownMs === "number" && obj.alertCooldownMs >= 0) n.alertCooldownMs = obj.alertCooldownMs;
  if (obj.quietHours !== undefined) {
    const parsed = parseQuietHours(obj.quietHours);
    if (parsed.ok) n.quietHours = parsed.config;
  }
  if (Object.keys(n).length > 0) out.notifications = n;
}

function sanitizeWorkflow(out: Partial<CoreKotaConfig>, src: KotaConfig["workflow"]): void {
  if (!isPlainObject(src)) return;
  const obj = src as Record<string, unknown>;
  const w: NonNullable<CoreKotaConfig["workflow"]> = {};
  if (typeof obj.maxStepOutputBytes === "number" && obj.maxStepOutputBytes > 0) w.maxStepOutputBytes = obj.maxStepOutputBytes;
  if (Object.keys(w).length > 0) out.workflow = w;
}

function sanitizeModuleMonitoring(
  out: Partial<CoreKotaConfig>,
  src: KotaConfig["moduleMonitoring"],
): void {
  if (!isPlainObject(src)) return;
  const obj = src as Record<string, unknown>;
  const mm: NonNullable<CoreKotaConfig["moduleMonitoring"]> = {};
  if (typeof obj.crashAlertThreshold === "number" && obj.crashAlertThreshold > 0 && Number.isInteger(obj.crashAlertThreshold)) mm.crashAlertThreshold = obj.crashAlertThreshold;
  if (typeof obj.crashAlertWindowMs === "number" && obj.crashAlertWindowMs > 0) mm.crashAlertWindowMs = obj.crashAlertWindowMs;
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
    if (Array.isArray(src.args)) fext.args = src.args.filter((a): a is string => typeof a === "string");
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
  return fexts;
}
