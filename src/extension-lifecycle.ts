import { resetDynamicStateProviders } from "./dynamic-state.js";
import type { ExtensionStorage } from "./extension-storage.js";
import type { ChannelDef } from "./channel.js";
import type { KotaExtension } from "./extension-types.js";
import { getProviderRegistry } from "./extensions/providers/index.js";
import { getToolMiddleware } from "./tool-middleware.js";
import { deregisterExtensionTools } from "./tools/index.js";
import type { RegisteredWorkflowDefinitionInput } from "./workflow/types.js";
import type { AgentDef, SkillDef } from "./agent-types.js";

export interface LifecycleState {
  extensions: KotaExtension[];
  extensionStorages: Map<string, ExtensionStorage>;
  extensionToolCounts: Map<string, number>;
  extensionRegistry: Map<string, KotaExtension>;
  extensionWorkflowDefs: Map<string, readonly RegisteredWorkflowDefinitionInput[]>;
  extensionChannelDefs: Map<string, readonly ChannelDef[]>;
  extensionSkillDefs: Map<string, readonly SkillDef[]>;
  extensionAgentDefs: Map<string, readonly AgentDef[]>;
  verbose: boolean;
}

export function getExtensionDependents(extensionName: string, extensions: KotaExtension[]): string[] {
  return extensions
    .filter((e) => e.dependencies?.includes(extensionName))
    .map((e) => e.name);
}

export async function unloadExtension(extensionName: string, state: LifecycleState): Promise<boolean> {
  const idx = state.extensions.findIndex((e) => e.name === extensionName);
  if (idx < 0) return false;

  const dependents = getExtensionDependents(extensionName, state.extensions);
  if (dependents.length > 0) {
    throw new Error(
      `Cannot unload "${extensionName}": depended on by ${dependents.map((d) => `"${d}"`).join(", ")}`,
    );
  }

  const ext = state.extensions[idx];

  if (ext.onUnload) {
    try {
      await ext.onUnload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[kota] Extension "${extensionName}" unload error: ${msg}`);
    }
  }

  deregisterExtensionTools(extensionName);
  getToolMiddleware().removeByOwner(extensionName);
  state.extensionStorages.delete(extensionName);
  state.extensionToolCounts.delete(extensionName);
  state.extensionWorkflowDefs.delete(extensionName);
  state.extensionChannelDefs.delete(extensionName);
  state.extensionSkillDefs.delete(extensionName);
  state.extensionAgentDefs.delete(extensionName);
  state.extensions.splice(idx, 1);

  if (state.verbose) console.error(`[kota] Extension "${extensionName}" unloaded`);
  return true;
}

export async function reloadExtension(
  extensionName: string,
  state: LifecycleState,
  loadFn: (ext: KotaExtension) => Promise<void>,
): Promise<boolean> {
  const ext = state.extensionRegistry.get(extensionName);
  if (!ext) return false;

  if (state.extensions.some((e) => e.name === extensionName)) {
    await unloadExtension(extensionName, state);
  }

  await loadFn(ext);

  if (state.verbose) console.error(`[kota] Extension "${extensionName}" reloaded`);
  return true;
}

export async function unloadAllExtensions(state: LifecycleState): Promise<void> {
  for (const ext of [...state.extensions].reverse()) {
    if (ext.onUnload) {
      try {
        await ext.onUnload();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[kota] Extension "${ext.name}" unload error: ${msg}`);
      }
    }
  }

  for (const ext of [...state.extensions]) deregisterExtensionTools(ext.name);
  state.extensions.splice(0);
  state.extensionRegistry.clear();
  state.extensionStorages.clear();
  state.extensionToolCounts.clear();
  state.extensionWorkflowDefs.clear();
  state.extensionChannelDefs.clear();
  state.extensionSkillDefs.clear();
  state.extensionAgentDefs.clear();

  const reg = getProviderRegistry();
  if (reg) reg.clear();
  getToolMiddleware().clear();
  resetDynamicStateProviders();
}
