import type { KotaConfig } from "#core/config/config.js";
import { updateScopeConfig } from "#core/config/config.js";
import type {
  ModuleSetupFormValue,
  ModuleSetupJsonValue,
  SetupConfigObject,
} from "./types.js";

export function readConfigPath(
  config: KotaConfig,
  path: string,
): ModuleSetupJsonValue | undefined {
  let current = config as SetupConfigObject;
  const parts = path.split(".");
  for (let index = 0; index < parts.length; index += 1) {
    const value = current[parts[index]!];
    if (value === undefined) return undefined;
    if (index === parts.length - 1) return value;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    current = value as SetupConfigObject;
  }
  return undefined;
}

export function setScopeConfigPath(
  scopeRoot: string,
  path: string,
  value: ModuleSetupFormValue,
): void {
  updateScopeConfig(scopeRoot, (raw) => {
    const root = raw as SetupConfigObject;
    const parts = path.split(".");
    let current = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index]!;
      const existing = current[part];
      if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
        current[part] = {};
      }
      current = current[part] as SetupConfigObject;
    }
    current[parts[parts.length - 1]!] = value;
    return raw;
  });
}

export function deleteScopeConfigPath(scopeRoot: string, path: string): void {
  updateScopeConfig(scopeRoot, (raw) => {
    const root = raw as SetupConfigObject;
    const parts = path.split(".");
    let current = root;
    for (let index = 0; index < parts.length - 1; index += 1) {
      const next = current[parts[index]!];
      if (typeof next !== "object" || next === null || Array.isArray(next)) return raw;
      current = next as SetupConfigObject;
    }
    delete current[parts[parts.length - 1]!];
    return raw;
  });
}
