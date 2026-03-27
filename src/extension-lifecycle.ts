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

export function getExtensionDependents(extensionName: string, extensions: KotaExtension[]): string[] {
  return extensions
    .filter((m) => m.dependencies?.includes(extensionName))
    .map((m) => m.name);
}

export async function unloadExtension(extensionName: string, state: LifecycleState): Promise<boolean> {
  const idx = state.extensions.findIndex((m) => m.name === extensionName);
  if (idx < 0) return false;

  const dependents = getExtensionDependents(extensionName, state.extensions);
  if (dependents.length > 0) {
    throw new Error(
      `Cannot unload "${extensionName}": depended on by ${dependents.map((d) => `"${d}"`).join(", ")}`,
    );
  }

  const mod = state.extensions[idx];

  if (mod.onUnload) {
    try {
      await mod.onUnload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[kota] Extension "${extensionName}" unload error: ${msg}`);
    }
  }

  deregisterExtensionTools(extensionName);
  getToolMiddleware().removeByOwner(extensionName);
  state.extensionStorages.delete(extensionName);
  state.extensionToolCounts.delete(extensionName);
  state.extensions.splice(idx, 1);

  if (state.verbose) console.error(`[kota] Extension "${extensionName}" unloaded`);
  return true;
}

export async function reloadExtension(
  extensionName: string,
  state: LifecycleState,
  loadFn: (mod: KotaExtension) => Promise<void>,
): Promise<boolean> {
  const mod = state.extensionRegistry.get(extensionName);
  if (!mod) return false;

  if (state.extensions.some((m) => m.name === extensionName)) {
    await unloadExtension(extensionName, state);
  }

  await loadFn(mod);

  if (state.verbose) console.error(`[kota] Extension "${extensionName}" reloaded`);
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
