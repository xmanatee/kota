/**
 * Shared read/mutate logic for `kota config` and the matching daemon
 * control routes.
 *
 * Both the CLI subcommand (via the local-client handler) and the daemon
 * control routes route through these functions so the two transports
 * share one definition of resolution, dot-notation lookup, and persisted
 * mutation semantics.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, updateProjectConfig } from "#core/config/config.js";
import { KNOWN_CONFIG_KEYS } from "#core/config/config-warnings.js";
import type {
  ConfigGetResult,
  ConfigSetResult,
  ConfigValidateResult,
} from "./client.js";

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

function isKnownKey(key: string, moduleKeys: ReadonlySet<string>): boolean {
  return KNOWN_CONFIG_KEYS.has(key) || moduleKeys.has(key);
}

export function validateConfig(
  projectDir: string,
  moduleKeys: ReadonlySet<string>,
): ConfigValidateResult {
  const globalPath = join(homedir(), ".kota", "config.json");
  const projectPath = join(projectDir, ".kota", "config.json");
  const resolved = loadConfig(projectDir);

  const sources: ConfigValidateResult["sources"] = [];
  if (existsSync(globalPath)) sources.push({ label: "global", path: globalPath });
  if (existsSync(projectPath)) sources.push({ label: "project", path: projectPath });

  const warnings: string[] = [];
  for (const { label, path } of sources) {
    const keys = readRawKeys(path);
    if (!keys) continue;
    for (const k of keys) {
      if (!isKnownKey(k, moduleKeys)) {
        warnings.push(`Unknown key "${k}" in ${label} config (${path})`);
      }
    }
  }

  return {
    sources,
    warnings,
    resolved: resolved as unknown as Record<string, unknown>,
  };
}

export function getConfigValue(projectDir: string, key: string): ConfigGetResult {
  const resolved = loadConfig(projectDir) as unknown as Record<string, unknown>;
  const parts = key.split(".");
  let current: unknown = resolved;
  for (const part of parts) {
    if (current === null || typeof current !== "object" || !(part in (current as Record<string, unknown>))) {
      return { found: false, reason: "not_found" };
    }
    current = (current as Record<string, unknown>)[part];
  }
  return { found: true, value: current };
}

function parseRawValue(rawValue: string): unknown {
  try {
    return JSON.parse(rawValue);
  } catch {
    return rawValue;
  }
}

export function setConfigValue(
  projectDir: string,
  moduleKeys: ReadonlySet<string>,
  key: string,
  rawValue: string,
): ConfigSetResult {
  const parsed = parseRawValue(rawValue);
  const parts = key.split(".");
  const topKey = parts[0];

  updateProjectConfig(projectDir, (raw) => {
    if (parts.length === 1) {
      return { ...raw, [parts[0]]: parsed } as typeof raw;
    }
    const existing = (raw as unknown as Record<string, unknown>)[parts[0]];
    const nested = existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
    nested[parts[1]] = parsed;
    return { ...raw, [parts[0]]: nested } as typeof raw;
  });

  return {
    ok: true,
    unknownKey: !isKnownKey(topKey, moduleKeys),
    topKey,
    value: parsed,
  };
}

export function configSchemaPath(): string {
  return fileURLToPath(new URL("../../../schema/kota-config.schema.json", import.meta.url));
}

export function configSchemaContent(): string {
  return readFileSync(configSchemaPath(), "utf-8");
}
