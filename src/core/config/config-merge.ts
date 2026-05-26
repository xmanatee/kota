/**
 * Layered config merge.
 *
 * Core-owned fields are merged inline; module-owned slices delegate to
 * each registered slice's `merge` callback so per-slice merge semantics
 * (replace vs. shallow-merge vs. concat) live in the owning module.
 */

import type { ModelTiers } from "../model/model-router.js";
import type { ModelOutputTokenLimits } from "../model/output-token-limits.js";
import type { ForeignModuleConfig } from "../modules/foreign-module.js";
import type { GuardrailsConfig } from "../tools/guardrails.js";
import type { CoreKotaConfig, KotaConfig } from "./config.js";
import { getRegisteredConfigSlice } from "./config-slice.js";

const CORE_KEYS: ReadonlySet<string> = new Set<keyof CoreKotaConfig>([
  "model",
  "editorModel",
  "maxTokens",
  "thinking",
  "thinkingBudget",
  "verbose",
  "skipConfirmations",
  "trustedProjects",
  "autoEnable",
  "user",
  "aliases",
  "reflection",
  "guardrails",
  "modules",
  "foreignModules",
  "providers",
  "modelTiers",
  "modelOutputTokenLimits",
  "agentModels",
  "defaultAgentHarness",
  "defaultPreset",
  "approvalTtlMs",
  "runsGc",
  "serve",
  "cli",
  "log",
  "daemon",
  "notifications",
  "moduleMonitoring",
  "workflow",
]);

/** Deep-merge two configs. `b` overrides `a`; objects/arrays merge per field. */
export function mergeConfigs(
  a: Partial<KotaConfig>,
  b: Partial<KotaConfig>,
): Partial<KotaConfig> {
  const merged = { ...a };

  for (const key of Object.keys(b) as (keyof KotaConfig)[]) {
    const val = b[key];
    if (val === undefined) continue;

    if (CORE_KEYS.has(key as string)) {
      mergeCoreField(merged, a, key as keyof CoreKotaConfig, val);
      continue;
    }

    const slice = getRegisteredConfigSlice(key as string);
    if (slice) {
      const baseVal = (a as Record<string, unknown>)[slice.key];
      (merged as Record<string, unknown>)[slice.key] = slice.merge(baseVal as never, val as never);
      continue;
    }

    // Unknown key: passthrough so unknown-key warnings still see it.
    (merged as Record<string, unknown>)[key as string] = val;
  }

  return merged;
}

function mergeCoreField(
  merged: Partial<KotaConfig>,
  a: Partial<KotaConfig>,
  key: keyof CoreKotaConfig,
  val: unknown,
): void {
  if (key === "user" && typeof val === "object") {
    merged.user = { ...a.user, ...(val as CoreKotaConfig["user"]) };
  } else if (key === "aliases" && typeof val === "object") {
    merged.aliases = { ...a.aliases, ...(val as Record<string, string>) };
  } else if (key === "guardrails" && typeof val === "object") {
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
  } else if (key === "modelTiers" && typeof val === "object") {
    merged.modelTiers = { ...a.modelTiers, ...(val as ModelTiers) };
  } else if (key === "modelOutputTokenLimits" && typeof val === "object") {
    merged.modelOutputTokenLimits = {
      ...a.modelOutputTokenLimits,
      ...(val as ModelOutputTokenLimits),
    };
  } else if (key === "agentModels" && typeof val === "object") {
    merged.agentModels = { ...a.agentModels, ...(val as Record<string, string>) };
  } else if (key === "runsGc" && typeof val === "object") {
    merged.runsGc = { ...a.runsGc, ...(val as CoreKotaConfig["runsGc"]) };
  } else if (key === "autoEnable" && Array.isArray(val)) {
    // Project autoEnable replaces global (not merges) — project knows best.
    merged.autoEnable = val as string[];
  } else if (key === "foreignModules" && Array.isArray(val)) {
    // Project foreign modules append to global.
    merged.foreignModules = [...(a.foreignModules ?? []), ...(val as ForeignModuleConfig[])];
  } else if (key === "notifications" && typeof val === "object") {
    merged.notifications = { ...a.notifications, ...(val as CoreKotaConfig["notifications"]) };
  } else if (key === "workflow" && typeof val === "object") {
    merged.workflow = { ...a.workflow, ...(val as CoreKotaConfig["workflow"]) };
  } else if (key === "moduleMonitoring" && typeof val === "object") {
    merged.moduleMonitoring = { ...a.moduleMonitoring, ...(val as CoreKotaConfig["moduleMonitoring"]) };
  } else if (key === "serve" && typeof val === "object") {
    merged.serve = { ...a.serve, ...(val as CoreKotaConfig["serve"]) };
  } else if (key === "cli" && typeof val === "object") {
    merged.cli = { ...a.cli, ...(val as CoreKotaConfig["cli"]) };
  } else if (key === "daemon" && typeof val === "object") {
    merged.daemon = { ...a.daemon, ...(val as CoreKotaConfig["daemon"]) };
  } else if (key === "log" && typeof val === "object") {
    merged.log = { ...a.log, ...(val as CoreKotaConfig["log"]) };
  } else {
    (merged as Record<string, unknown>)[key as string] = val;
  }
}
