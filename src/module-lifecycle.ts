import type { EventBus } from "./event-bus.js";
import type { ModuleStorage } from "./module-storage.js";
import type { KotaModule } from "./module-types.js";
import { getProviderRegistry } from "./providers.js";
import { getToolMiddleware } from "./tool-middleware.js";
import { deregisterModuleTools } from "./tools/index.js";

export interface LifecycleState {
  modules: KotaModule[];
  eventUnsubs: Array<() => void>;
  moduleEventUnsubs: Map<string, Array<() => void>>;
  moduleStorages: Map<string, ModuleStorage>;
  moduleToolCounts: Map<string, number>;
  promptSections: Map<string, string>;
  moduleRegistry: Map<string, KotaModule>;
  verbose: boolean;
}

export function getModuleDependents(moduleName: string, modules: KotaModule[]): string[] {
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
  const unsubs = state.moduleEventUnsubs.get(moduleName);
  if (unsubs) {
    for (const unsub of unsubs) unsub();
    const toRemove = new Set(unsubs);
    for (let i = state.eventUnsubs.length - 1; i >= 0; i--) {
      if (toRemove.has(state.eventUnsubs[i])) state.eventUnsubs.splice(i, 1);
    }
    state.moduleEventUnsubs.delete(moduleName);
  }

  if (mod.onUnload) {
    try {
      await mod.onUnload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[kota] Module "${moduleName}" unload error: ${msg}`);
    }
  }

  deregisterModuleTools(moduleName);
  getToolMiddleware().removeByOwner(moduleName);
  state.promptSections.delete(moduleName);
  state.moduleStorages.delete(moduleName);
  state.moduleToolCounts.delete(moduleName);
  state.modules.splice(idx, 1);

  if (state.verbose) console.error(`[kota] Module "${moduleName}" unloaded`);
  return true;
}

export async function reloadModule(
  moduleName: string,
  state: LifecycleState,
  bus: EventBus | null,
  loadFn: (mod: KotaModule) => Promise<void>,
  connectEventsFn: (mod: KotaModule, bus: EventBus) => void,
): Promise<boolean> {
  const mod = state.moduleRegistry.get(moduleName);
  if (!mod) return false;

  if (state.modules.some((m) => m.name === moduleName)) {
    await unloadModule(moduleName, state);
  }

  await loadFn(mod);

  if (bus) connectEventsFn(mod, bus);

  if (state.verbose) console.error(`[kota] Module "${moduleName}" reloaded`);
  return true;
}

export async function unloadAllModules(state: LifecycleState): Promise<void> {
  for (const unsub of state.eventUnsubs) unsub();
  state.eventUnsubs.splice(0);

  for (const mod of [...state.modules].reverse()) {
    if (mod.onUnload) {
      try {
        await mod.onUnload();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[kota] Module "${mod.name}" unload error: ${msg}`);
      }
    }
  }

  for (const mod of [...state.modules]) deregisterModuleTools(mod.name);
  state.modules.splice(0);
  state.moduleEventUnsubs.clear();
  state.moduleRegistry.clear();
  state.moduleStorages.clear();
  state.moduleToolCounts.clear();
  state.promptSections.clear();

  const reg = getProviderRegistry();
  if (reg) reg.clear();
  getToolMiddleware().clear();
}
