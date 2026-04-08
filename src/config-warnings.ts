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
  "extensions",
  "foreignExtensions",
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
