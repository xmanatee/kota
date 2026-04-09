import { resetDynamicStateProviders } from "./dynamic-state.js";
import type { ModuleStorage } from "./module-storage.js";
import type { ChannelDef } from "./channel.js";
import type { KotaModule } from "./module-types.js";
import { getProviderRegistry } from "./modules/providers/index.js";
import { getToolMiddleware } from "./tool-middleware.js";
import { deregisterModuleTools } from "./tools/index.js";
import type { RegisteredWorkflowDefinitionInput } from "./workflow/types.js";
import type { AgentDef, SkillDef } from "./agent-types.js";

export interface LifecycleState {
  modules: KotaModule[];
  moduleStorages: Map<string, ModuleStorage>;
  moduleToolCounts: Map<string, number>;
  moduleRegistry: Map<string, KotaModule>;
  moduleWorkflowDefs: Map<string, readonly RegisteredWorkflowDefinitionInput[]>;
  moduleChannelDefs: Map<string, readonly ChannelDef[]>;
  moduleSkillDefs: Map<string, readonly SkillDef[]>;
  moduleAgentDefs: Map<string, readonly AgentDef[]>;
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
  state.moduleStorages.delete(moduleName);
  state.moduleToolCounts.delete(moduleName);
  state.moduleWorkflowDefs.delete(moduleName);
  state.moduleChannelDefs.delete(moduleName);
  state.moduleSkillDefs.delete(moduleName);
  state.moduleAgentDefs.delete(moduleName);
  state.modules.splice(idx, 1);

  if (state.verbose) console.error(`[kota] Module "${moduleName}" unloaded`);
  return true;
}

export async function reloadModule(
  moduleName: string,
  state: LifecycleState,
  loadFn: (mod: KotaModule) => Promise<void>,
): Promise<boolean> {
  const mod = state.moduleRegistry.get(moduleName);
  if (!mod) return false;

  if (state.modules.some((m) => m.name === moduleName)) {
    await unloadModule(moduleName, state);
  }

  await loadFn(mod);

  if (state.verbose) console.error(`[kota] Module "${moduleName}" reloaded`);
  return true;
}

export async function unloadAllModules(state: LifecycleState): Promise<void> {
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
  state.moduleRegistry.clear();
  state.moduleStorages.clear();
  state.moduleToolCounts.clear();
  state.moduleWorkflowDefs.clear();
  state.moduleChannelDefs.clear();
  state.moduleSkillDefs.clear();
  state.moduleAgentDefs.clear();

  const reg = getProviderRegistry();
  if (reg) reg.clear();
  getToolMiddleware().clear();
  resetDynamicStateProviders();
}
