import type { KotaConfig } from "#core/config/config.js";

type ModuleDep = { name: string; dependencies: string[] };

/**
 * Computes which modules need reloading based on config changes between old and new.
 *
 * - If any global (non-modules) config key changed, all modules need reload.
 * - Otherwise, only modules whose `modules.<name>` config subtree changed
 *   (plus any modules that transitively depend on them) need reload.
 */
export function computeModuleConfigDiff(
  oldConfig: KotaConfig,
  newConfig: KotaConfig,
  allModules: ModuleDep[],
): { changedModules: string[]; isFullReload: boolean } {
  if (hasGlobalKeyChanged(oldConfig, newConfig)) {
    return { changedModules: allModules.map((m) => m.name), isFullReload: true };
  }

  const directlyChanged = findChangedModules(
    oldConfig.modules ?? {},
    newConfig.modules ?? {},
  );
  if (directlyChanged.size === 0) {
    return { changedModules: [], isFullReload: false };
  }

  const expanded = expandDependents(directlyChanged, allModules);
  return { changedModules: [...expanded], isFullReload: false };
}

function hasGlobalKeyChanged(oldConfig: KotaConfig, newConfig: KotaConfig): boolean {
  const oldKeys = Object.keys(oldConfig).filter((k) => k !== "modules");
  const newKeys = Object.keys(newConfig).filter((k) => k !== "modules");
  const allKeys = new Set([...oldKeys, ...newKeys]);
  return [...allKeys].some(
    (k) =>
      !deepEqual(
        (oldConfig as Record<string, unknown>)[k],
        (newConfig as Record<string, unknown>)[k],
      ),
  );
}

function findChangedModules(
  oldModules: Record<string, Record<string, unknown>>,
  newModules: Record<string, Record<string, unknown>>,
): Set<string> {
  const allNames = new Set([...Object.keys(oldModules), ...Object.keys(newModules)]);
  const changed = new Set<string>();
  for (const name of allNames) {
    if (!deepEqual(oldModules[name], newModules[name])) {
      changed.add(name);
    }
  }
  return changed;
}

function expandDependents(changed: Set<string>, allModules: ModuleDep[]): Set<string> {
  const result = new Set(changed);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const mod of allModules) {
      if (!result.has(mod.name) && mod.dependencies.some((dep) => result.has(dep))) {
        result.add(mod.name);
        expanded = true;
      }
    }
  }
  return result;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a !== "object" || typeof b !== "object") return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}
