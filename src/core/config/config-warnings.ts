import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isWorkflowConcurrency,
  MAX_WORKFLOW_CONCURRENCY,
} from "#core/workflow/concurrency.js";
import { type KotaConfig, loadConfigWithDiagnostics } from "./config.js";

/**
 * Top-level config keys the core owns. Module-owned slice keys
 * (`webhooks`, `tracing`, `mcp`, `failover`, `modelProvider`, `scheduler`,
 * …) are recognized via the module slice registry plus the loader's
 * `getRegisteredConfigKeys()` snapshot, not enumerated here.
 */
export const KNOWN_CONFIG_KEYS: ReadonlySet<string> = new Set<keyof KotaConfig>([
  "model",
  "editorModel",
  "maxTokens",
  "thinking",
  "thinkingBudget",
  "verbose",
  "skipConfirmations",
  "trustedScopes",
  "scopePolicies",
  "scopeAuthority",
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
  "workflow",
  "moduleMonitoring",
]);

function readRawKeys(path: string): string[] | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    return Object.keys(raw);
  } catch {
    return null;
  }
}

/**
 * Checks the scope-level .kota/config.json for unknown top-level keys and
 * calls `warn` for each one found. Safe to call at startup; non-fatal.
 *
 * `moduleKeys` contains additional keys registered by loaded modules.
 */
export function warnUnknownConfigKeys(
  scopeRoot: string,
  warn: (message: string) => void,
  moduleKeys?: ReadonlySet<string>,
): void {
  const workspacePath = join(scopeRoot, ".kota", "config.json");
  const keys = readRawKeys(workspacePath);
  if (!keys) return;
  for (const k of keys) {
    if (KNOWN_CONFIG_KEYS.has(k)) continue;
    if (moduleKeys?.has(k)) continue;
    warn(`Config warning: unknown key "${k}" in ${workspacePath}`);
  }
}

export function warnIgnoredUntrustedScopeConfig(
  scopeRoot: string,
  warn: (message: string) => void,
): void {
  const diagnostics = loadConfigWithDiagnostics(scopeRoot);
  for (const warning of diagnostics.warnings) {
    warn(`Config warning: ${warning}`);
  }
}

/**
 * Validates scheduler.concurrency when present. Invalid values are ignored at
 * parse time and the default applies.
 */
export function warnInvalidConcurrencyConfig(
  scopeRoot: string,
  warn: (message: string) => void,
): void {
  const workspacePath = join(scopeRoot, ".kota", "config.json");
  if (!existsSync(workspacePath)) return;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(workspacePath, "utf-8"));
  } catch {
    return;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return;
  const cfg = raw as Record<string, unknown>;
  if (typeof cfg.scheduler !== "object" || cfg.scheduler === null || Array.isArray(cfg.scheduler)) return;
  const scheduler = cfg.scheduler as Record<string, unknown>;
  const val = scheduler.concurrency;
  if (val !== undefined && !isWorkflowConcurrency(val)) {
    warn(`Config warning: scheduler.concurrency must be an integer from 1 to ${MAX_WORKFLOW_CONCURRENCY} (got ${JSON.stringify(val)}); using default`);
  }
}
