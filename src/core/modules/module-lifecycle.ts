import { unregisterConfigSlicesForOwner } from "#core/config/config-slice.js";
import { getModuleEventRegistry } from "#core/events/module-event.js";
import { removeCleanupHooks, resetCleanupHooks } from "#core/loop/cleanup-hooks.js";
import { resetDynamicStateProviders } from "#core/loop/dynamic-state.js";
import { removePreSendHooks, resetPreSendHooks } from "#core/loop/pre-send-hooks.js";
import { deregisterModuleTools } from "#core/tools/index.js";
import { getToolMiddleware } from "#core/tools/tool-middleware.js";
import type { LoaderState } from "./module-loader-state.js";
import type { KotaModule } from "./module-types.js";
import { getProviderRegistry } from "./provider-registry.js";

export interface ModuleLoadFailure {
  message: string;
  timestamp: string;
}

export interface LifecycleEnv {
  resetBus: () => void;
  verbose: boolean;
}

export function getModuleDependents(moduleName: string, modules: readonly KotaModule[]): string[] {
  return modules
    .filter((m) => m.dependencies?.includes(moduleName))
    .map((m) => m.name);
}

export async function unloadModule(
  moduleName: string,
  state: LoaderState,
  env: LifecycleEnv,
): Promise<boolean> {
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
  removeCleanupHooks(moduleName);
  removePreSendHooks(moduleName);

  cleanupLoaderState(moduleName, state);

  if (env.verbose) console.error(`[kota] Module "${moduleName}" unloaded`);
  return true;
}

export async function unloadAllModules(state: LoaderState, env: LifecycleEnv): Promise<void> {
  const owners = [...new Set(state.registeredConfigKeys.values())];
  const loadedModules = [...state.modules];
  const eventOwners = loadedModules.map((m) => m.name);

  // AgentSession.close() is synchronous, so this cleanup must happen before
  // any async onUnload hook can yield and race the next session's module load.
  for (const mod of loadedModules) deregisterModuleTools(mod.name);
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
  resetCleanupHooks();
  resetDynamicStateProviders();
  resetPreSendHooks();

  for (const owner of owners) unregisterConfigSlicesForOwner(owner);
  const registry = getModuleEventRegistry();
  if (registry) {
    for (const owner of eventOwners) registry.unregisterModule(owner);
  }
  state.registeredConfigKeys.clear();
  state.contributedWorkflows.splice(0);
  state.contributedChannels.splice(0);
  state.skillContentsByName.clear();
  state.skillDefsByName.clear();
  state.moduleRoutes.clear();
  state.moduleCommands.clear();
  state.moduleControlRoutes.clear();
  state.moduleRouteErrors.clear();
  state.moduleCommandErrors.clear();
  state.moduleControlRouteErrors.clear();
  state.moduleSources.clear();
  state.loadFailures.clear();
  env.resetBus();

  for (const mod of loadedModules.reverse()) {
    if (mod.onUnload) {
      try {
        await mod.onUnload();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[kota] Module "${mod.name}" unload error: ${msg}`);
      }
    }
  }
}

function cleanupLoaderState(moduleName: string, state: LoaderState): void {
  for (const [key, owner] of state.registeredConfigKeys) {
    if (owner === moduleName) state.registeredConfigKeys.delete(key);
  }
  unregisterConfigSlicesForOwner(moduleName);
  getModuleEventRegistry()?.unregisterModule(moduleName);
  state.moduleRoutes.delete(moduleName);
  state.moduleCommands.delete(moduleName);
  state.moduleControlRoutes.delete(moduleName);
  state.moduleRouteErrors.delete(moduleName);
  state.moduleCommandErrors.delete(moduleName);
  state.moduleControlRouteErrors.delete(moduleName);

  const wfDefs = state.moduleWorkflowDefs.get(moduleName);
  if (wfDefs) {
    const wfNames = new Set(wfDefs.map((w) => w.name));
    for (let i = state.contributedWorkflows.length - 1; i >= 0; i--) {
      if (wfNames.has(state.contributedWorkflows[i].name)) {
        state.contributedWorkflows.splice(i, 1);
      }
    }
  }

  const chDefs = state.moduleChannelDefs.get(moduleName);
  if (chDefs) {
    const chNames = new Set(chDefs.map((c) => c.name));
    for (let i = state.contributedChannels.length - 1; i >= 0; i--) {
      if (chNames.has(state.contributedChannels[i].name)) {
        state.contributedChannels.splice(i, 1);
      }
    }
  }

  const skillDefs = state.moduleSkillDefs.get(moduleName);
  if (skillDefs) {
    for (const skill of skillDefs) {
      state.skillContentsByName.delete(skill.name);
      state.skillDefsByName.delete(skill.name);
    }
  }
}
