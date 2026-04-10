import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { KotaConfig } from "./config.js";

export const KNOWN_CONFIG_KEYS: ReadonlySet<string> = new Set<keyof KotaConfig>([
  "model",
  "editorModel",
  "maxTokens",
  "architect",
  "thinking",
  "thinkingBudget",
  "verbose",
  "skipConfirmations",
  "autoEnable",
  "user",
  "aliases",
  "reflection",
  "guardrails",
  "modules",
  "foreignModules",
  "providers",
  "modelProvider",
  "modelTiers",
  "agentModels",
  "webhooks",
  "approvalTtlMs",
  "dailyBudgetUsd",
  "runsGc",
  "serve",
  "log",
  "daemon",
  "notifications",
  "scheduler",
  "workflow",
  "budget",
  "mcp",
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
 * Checks the project-level .kota/config.json for unknown top-level keys and
 * calls `warn` for each one found. Safe to call at startup; non-fatal.
 */
export function warnUnknownConfigKeys(
  projectDir: string,
  warn: (message: string) => void,
): void {
  const projectPath = join(projectDir, ".kota", "config.json");
  const keys = readRawKeys(projectPath);
  if (!keys) return;
  for (const k of keys) {
    if (!KNOWN_CONFIG_KEYS.has(k)) {
      warn(`Config warning: unknown key "${k}" in ${projectPath}`);
    }
  }
}

/**
 * Validates scheduler.agentConcurrency and scheduler.codeConcurrency when
 * present in the project config, warning if they are invalid (non-positive or
 * non-integer). Invalid values are ignored at parse time and the defaults apply.
 */
export function warnInvalidConcurrencyConfig(
  projectDir: string,
  warn: (message: string) => void,
): void {
  const projectPath = join(projectDir, ".kota", "config.json");
  if (!existsSync(projectPath)) return;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(projectPath, "utf-8"));
  } catch {
    return;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return;
  const cfg = raw as Record<string, unknown>;
  if (typeof cfg.scheduler !== "object" || cfg.scheduler === null || Array.isArray(cfg.scheduler)) return;
  const scheduler = cfg.scheduler as Record<string, unknown>;
  for (const key of ["agentConcurrency", "codeConcurrency"] as const) {
    const val = scheduler[key];
    if (val === undefined) continue;
    if (typeof val !== "number" || !Number.isInteger(val) || val <= 0) {
      warn(`Config warning: scheduler.${key} must be a positive integer (got ${JSON.stringify(val)}); using default`);
    }
  }
}
