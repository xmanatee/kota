import { removeHarnessHooks } from "#core/agent-harness/hooks.js";
import { unregisterConfigSlicesForOwner } from "#core/config/config-slice.js";
import { getModuleEventRegistry } from "#core/events/module-event.js";
import { removeCleanupHooks } from "#core/loop/cleanup-hooks.js";
import { removeDynamicStateProviders } from "#core/loop/dynamic-state.js";
import { removePreSendHooks } from "#core/loop/pre-send-hooks.js";
import { deregisterModuleTools } from "#core/tools/index.js";
import { getToolMiddleware } from "#core/tools/tool-middleware.js";
import type { LocalClientHandlers } from "#root/client/kota-client.generated.js";
import { clearModuleEventSubscriptions } from "./module-event-lifecycle.js";
import type { LoaderState } from "./module-loader-state.js";
import type { KotaModule } from "./module-types.js";
import {
  getRenderingProvider,
  type ProviderRegistry,
} from "./provider-registry.js";
import {
  createTerminalDiagnostic,
  printTerminalDiagnostic,
} from "./terminal-renderer.js";

export interface ModuleLoadFailure {
  message: string;
  timestamp: string;
}

export interface LifecycleEnv {
  resetBus: () => void;
  verbose: boolean;
  providerRegistry: ProviderRegistry;
}

export function getModuleDependents(moduleName: string, modules: readonly KotaModule[]): string[] {
  return modules
    .filter((m) => m.dependencies?.includes(moduleName))
    .map((m) => m.name);
}

function deleteLocalClientHandler<K extends keyof LocalClientHandlers>(
  handlers: Partial<LocalClientHandlers>,
  namespace: K,
): void {
  delete handlers[namespace];
}

export function discardModuleLoadState(
  moduleName: string,
  state: LoaderState,
  providerRegistry: ProviderRegistry,
): void {
  clearModuleEventSubscriptions(state, moduleName);
  deregisterModuleTools(moduleName);
  getToolMiddleware().removeByOwner(moduleName);

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

  for (const namespace of state.moduleLocalClientNamespaces.get(moduleName) ?? []) {
    deleteLocalClientHandler(state.localClientHandlers, namespace);
  }
  for (let i = state.daemonClientFactories.length - 1; i >= 0; i--) {
    if (state.daemonClientFactories[i].moduleName === moduleName) {
      state.daemonClientFactories.splice(i, 1);
    }
  }

  unregisterConfigSlicesForOwner(moduleName);
  getModuleEventRegistry()?.unregisterModule(moduleName);
  state.moduleStorages.delete(moduleName);
  state.moduleToolCounts.delete(moduleName);
  state.moduleToolDefs.delete(moduleName);
  state.moduleWorkflowDefs.delete(moduleName);
  state.moduleChannelDefs.delete(moduleName);
  state.moduleUiSurfaceSources.delete(moduleName);
  state.moduleSkillDefs.delete(moduleName);
  state.moduleAgentDefs.delete(moduleName);
  state.moduleSetupRequirementDefs.delete(moduleName);
  state.moduleManifests.delete(moduleName);
  state.moduleLocalClientNamespaces.delete(moduleName);
  state.moduleRoutes.delete(moduleName);
  state.moduleCommands.delete(moduleName);
  state.moduleControlRoutes.delete(moduleName);
  state.moduleRouteErrors.delete(moduleName);
  state.moduleCommandErrors.delete(moduleName);
  state.moduleControlRouteErrors.delete(moduleName);
  state.moduleRegistry.delete(moduleName);
  state.moduleActivations.delete(moduleName);
  for (const [key, owner] of state.registeredConfigKeys) {
    if (owner === moduleName) state.registeredConfigKeys.delete(key);
  }
  removeCleanupHooks(moduleName);
  removeDynamicStateProviders(moduleName);
  removePreSendHooks(moduleName);
  removeHarnessHooks(moduleName);
  providerRegistry.unregisterOwner(moduleName);
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

  const activation = state.moduleActivations.get(moduleName);
  if (activation) {
    try {
      await activation.dispose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      printTerminalDiagnostic(`[kota] Module "${moduleName}" dispose error: ${msg}`, "error");
    }
  } else if (mod.onUnload) {
    try {
      await mod.onUnload();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      printTerminalDiagnostic(`[kota] Module "${moduleName}" unload error: ${msg}`, "error");
    }
  }

  state.modules.splice(idx, 1);
  discardModuleLoadState(moduleName, state, env.providerRegistry);

  if (env.verbose) printTerminalDiagnostic(`[kota] Module "${moduleName}" unloaded`);
  return true;
}

export async function unloadAllModules(state: LoaderState, env: LifecycleEnv): Promise<void> {
  const loadedModules = [...state.modules];
  const activations = new Map(state.moduleActivations);
  const renderingProvider = getRenderingProvider(env.providerRegistry);

  // Withdraw executable contributions synchronously before any disposer can
  // yield. Each remaining contribution is then removed by its owner; unrelated
  // process-owned registries are never reset as a side effect of this host.
  for (const mod of loadedModules) deregisterModuleTools(mod.name);
  clearModuleEventSubscriptions(state);
  state.modules.splice(0);

  for (const mod of loadedModules.reverse()) {
    const activation = activations.get(mod.name);
    const dispose = activation?.dispose ?? mod.onUnload;
    if (dispose) {
      try {
        await dispose();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const message = `[kota] Module "${mod.name}" unload error: ${msg}`;
        if (renderingProvider) {
          renderingProvider.printDiagnostic(createTerminalDiagnostic(message, "error"));
        } else {
          printTerminalDiagnostic(message, "error");
        }
      }
    }
    discardModuleLoadState(mod.name, state, env.providerRegistry);
  }

  state.moduleSources.clear();
  state.loadFailures.clear();
  env.resetBus();
}
