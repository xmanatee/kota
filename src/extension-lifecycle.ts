import type { ExtensionStorage } from "./extension-storage.js";
import type { KotaExtension } from "./extension-types.js";
import { getProviderRegistry } from "./providers.js";
import { getToolMiddleware } from "./tool-middleware.js";
import { deregisterExtensionTools } from "./tools/index.js";

export interface LifecycleState {
  extensions: KotaExtension[];
  extensionStorages: Map<string, ExtensionStorage>;
  extensionToolCounts: Map<string, number>;
  extensionRegistry: Map<string, KotaExtension>;
  verbose: boolean;
}

export function getModuleDependents(moduleName: string, extensions: KotaExtension[]): string[] {
  return extensions
    .filter((m) => m.dependencies?.includes(moduleName))
    .map((m) => m.name);
}

export async function unloadModule(moduleName: string, state: LifecycleState): Promise<boolean> {
  const idx = state.extensions.findIndex((m) => m.name === moduleName);
  if (idx < 0) return false;

  const dependents = getModuleDependents(moduleName, state.extensions);
  if (dependents.length > 0) {
    throw new Error(
      `Cannot unload "${moduleName}": depended on by ${dependents.map((d) => `"${d}"`).join(", ")}`,
    );
  }

  const mod = state.extensions[idx];

  if (mod.onUnload) {
    try {
      await mod.onUnload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[kota] Extension "${moduleName}" unload error: ${msg}`);
    }
  }

  deregisterExtensionTools(moduleName);
  getToolMiddleware().removeByOwner(moduleName);
  state.extensionStorages.delete(moduleName);
  state.extensionToolCounts.delete(moduleName);
  state.extensions.splice(idx, 1);

  if (state.verbose) console.error(`[kota] Extension "${moduleName}" unloaded`);
  return true;
}

export async function reloadModule(
  moduleName: string,
  state: LifecycleState,
  loadFn: (mod: KotaExtension) => Promise<void>,
): Promise<boolean> {
  const mod = state.extensionRegistry.get(moduleName);
  if (!mod) return false;

  if (state.extensions.some((m) => m.name === moduleName)) {
    await unloadModule(moduleName, state);
  }

  await loadFn(mod);

  if (state.verbose) console.error(`[kota] Extension "${moduleName}" reloaded`);
  return true;
}

export async function unloadAllModules(state: LifecycleState): Promise<void> {
  for (const mod of [...state.extensions].reverse()) {
    if (mod.onUnload) {
      try {
        await mod.onUnload();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[kota] Extension "${mod.name}" unload error: ${msg}`);
      }
    }
  }

  for (const mod of [...state.extensions]) deregisterExtensionTools(mod.name);
  state.extensions.splice(0);
  state.extensionRegistry.clear();
  state.extensionStorages.clear();
  state.extensionToolCounts.clear();

  const reg = getProviderRegistry();
  if (reg) reg.clear();
  getToolMiddleware().clear();
}
