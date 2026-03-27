import type { ExtensionStorage } from "./extension-storage.js";
import type { KotaExtension } from "./extension-types.js";
import { getProviderRegistry } from "./providers.js";
import { getToolMiddleware } from "./tool-middleware.js";
import { deregisterModuleTools } from "./tools/index.js";

export interface LifecycleState {
  modules: KotaExtension[];
  moduleStorages: Map<string, ExtensionStorage>;
  moduleToolCounts: Map<string, number>;
  moduleRegistry: Map<string, KotaExtension>;
  verbose: boolean;
}

export function getModuleDependents(moduleName: string, modules: KotaExtension[]): string[] {
  return modules
    .filter((m) => m.dependencies?.includes(moduleName))
    .map((m) => m.name);
}

export async function unloadModule(moduleName: string, state: LifecycleState): Promise<boolean> {
  const idx = state.modules.findIndex((m) => m.name === moduleName);
  if (idx < 0) return false;

  const dependents = getModuleDependents(moduleName, state.modules);
  if (dependents.length > 0) {
    throw new Error(
      `Cannot unload "${moduleName}": depended on by ${dependents.map((d) => `"${d}"`).join(", ")}`,
    );
  }

  const mod = state.modules[idx];

  if (mod.onUnload) {
    try {
      await mod.onUnload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[kota] Extension "${moduleName}" unload error: ${msg}`);
    }
  }

  deregisterModuleTools(moduleName);
  getToolMiddleware().removeByOwner(moduleName);
  state.moduleStorages.delete(moduleName);
  state.moduleToolCounts.delete(moduleName);
  state.modules.splice(idx, 1);

  if (state.verbose) console.error(`[kota] Extension "${moduleName}" unloaded`);
  return true;
}

export async function reloadModule(
  moduleName: string,
  state: LifecycleState,
  loadFn: (mod: KotaExtension) => Promise<void>,
): Promise<boolean> {
  const mod = state.moduleRegistry.get(moduleName);
  if (!mod) return false;

  if (state.modules.some((m) => m.name === moduleName)) {
    await unloadModule(moduleName, state);
  }

  await loadFn(mod);

  if (state.verbose) console.error(`[kota] Extension "${moduleName}" reloaded`);
  return true;
}

export async function unloadAllModules(state: LifecycleState): Promise<void> {
  for (const mod of [...state.modules].reverse()) {
    if (mod.onUnload) {
      try {
        await mod.onUnload();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[kota] Extension "${mod.name}" unload error: ${msg}`);
      }
    }
  }

  for (const mod of [...state.modules]) deregisterModuleTools(mod.name);
  state.modules.splice(0);
  state.moduleRegistry.clear();
  state.moduleStorages.clear();
  state.moduleToolCounts.clear();

  const reg = getProviderRegistry();
  if (reg) reg.clear();
  getToolMiddleware().clear();
}
