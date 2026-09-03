import { removeHarnessHooks } from "#core/agent-harness/hooks.js";
import { removeCleanupHooks } from "#core/loop/cleanup-hooks.js";
import { removeDynamicStateProviders } from "#core/loop/dynamic-state.js";
import { removePreSendHooks } from "#core/loop/pre-send-hooks.js";
import { deregisterModuleTools } from "#core/tools/index.js";
import { getToolMiddleware } from "#core/tools/tool-middleware.js";
import type { LocalClientHandlers } from "#root/client/kota-client.generated.js";
import { clearModuleEventSubscriptions } from "./module-event-lifecycle.js";
import type { LoaderState } from "./module-loader-state.js";
import type { KotaModule, ModuleSource } from "./module-types.js";
import {
  getRenderingProvider,
  type ProviderRegistry,
} from "./provider-registry.js";
import {
  createTerminalDiagnostic,
  printTerminalDiagnostic,
} from "./terminal-renderer.js";

export interface ModuleLoadFailure {
  name: string;
  source: ModuleSource;
  message: string;
  timestamp: string;
}

export interface LifecycleEnv {
  resetBus: () => void;
  verbose: boolean;
  providerRegistry: ProviderRegistry;
  mode: "commands" | "runtime";
}

export function getModuleDependents(
  moduleName: string,
  modules: readonly KotaModule[],
): string[] {
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

function removeOwnedContributions<T>(target: T[], owned: readonly T[]): void {
  const remaining = [...owned];
  for (let i = target.length - 1; i >= 0 && remaining.length > 0; i--) {
    let ownedIndex = -1;
    for (let j = remaining.length - 1; j >= 0; j--) {
      if (Object.is(remaining[j], target[i])) {
        ownedIndex = j;
        break;
      }
    }
    if (ownedIndex < 0) continue;
    target.splice(i, 1);
    remaining.splice(ownedIndex, 1);
  }
}

export function discardModuleLoadState(
  moduleName: string,
  state: LoaderState,
  providerRegistry: ProviderRegistry,
  mode: "commands" | "runtime",
): void {
  for (
    const dispose of [
      ...(state.moduleAgentHarnessDisposers.get(moduleName) ?? []),
    ].reverse()
  ) {
    dispose();
  }
  for (
    const dispose of [
      ...(state.moduleConfigSliceDisposers.get(moduleName) ?? []),
    ].reverse()
  ) {
    dispose();
  }
  for (
    const dispose of [
      ...(state.moduleEventRegistrationDisposers.get(moduleName) ?? []),
    ].reverse()
  ) {
    dispose();
  }
  clearModuleEventSubscriptions(state, moduleName);
  if (mode === "runtime") {
    deregisterModuleTools(moduleName);
    getToolMiddleware().removeByOwner(moduleName);
  }

  const wfDefs = state.moduleWorkflowDefs.get(moduleName);
  if (wfDefs) removeOwnedContributions(state.contributedWorkflows, wfDefs);

  const chDefs = state.moduleChannelDefs.get(moduleName);
  if (chDefs) removeOwnedContributions(state.contributedChannels, chDefs);

  const skillDefs = state.moduleSkillDefs.get(moduleName);
  if (skillDefs) {
    for (const skill of skillDefs) {
      if (state.skillDefsByName.get(skill.name) === skill) {
        state.skillContentsByName.delete(skill.name);
        state.skillDefsByName.delete(skill.name);
      }
    }
  }

  for (
    const namespace of state.moduleLocalClientNamespaces.get(moduleName) ?? []
  ) {
    deleteLocalClientHandler(state.localClientHandlers, namespace);
  }
  for (let i = state.daemonClientFactories.length - 1; i >= 0; i--) {
    if (state.daemonClientFactories[i].moduleName === moduleName) {
      state.daemonClientFactories.splice(i, 1);
    }
  }

  state.moduleStorages.delete(moduleName);
  state.moduleToolCounts.delete(moduleName);
  state.moduleToolDefs.delete(moduleName);
  state.moduleWorkflowDefs.delete(moduleName);
  state.moduleChannelDefs.delete(moduleName);
  state.moduleUiSurfaceSources.delete(moduleName);
  state.moduleSkillDefs.delete(moduleName);
  const agentDefs = state.moduleAgentDefs.get(moduleName);
  if (agentDefs) {
    for (const agent of agentDefs) {
      const registered = state.agentsByName.get(agent.name);
      if (registered?.owner === moduleName && registered.definition === agent) {
        state.agentsByName.delete(agent.name);
      }
    }
  }
  state.moduleAgentDefs.delete(moduleName);
  state.moduleAgentHarnessDisposers.delete(moduleName);
  state.moduleConfigSliceDisposers.delete(moduleName);
  state.moduleEventRegistrationDisposers.delete(moduleName);
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
  if (mode === "runtime") {
    removeCleanupHooks(moduleName);
    removeDynamicStateProviders(moduleName);
    removePreSendHooks(moduleName);
    removeHarnessHooks(moduleName);
    providerRegistry.unregisterOwner(moduleName);
  }
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
      `Cannot unload "${moduleName}": depended on by ${
        dependents.map((d) => `"${d}"`).join(", ")
      }`,
    );
  }

  const activation = state.moduleActivations.get(moduleName);
  if (activation) {
    try {
      await activation.dispose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      printTerminalDiagnostic(
        `[kota] Module "${moduleName}" dispose error: ${msg}`,
        "error",
      );
    }
  }

  state.modules.splice(idx, 1);
  discardModuleLoadState(moduleName, state, env.providerRegistry, env.mode);

  if (env.verbose) {
    printTerminalDiagnostic(`[kota] Module "${moduleName}" unloaded`);
  }
  return true;
}

export async function unloadAllModules(
  state: LoaderState,
  env: LifecycleEnv,
): Promise<void> {
  const loadedModules = [...state.modules];
  const activations = new Map(state.moduleActivations);
  const renderingProvider = getRenderingProvider(env.providerRegistry);

  // Withdraw executable contributions synchronously before any disposer can
  // yield. Each remaining contribution is then removed by its owner; unrelated
  // process-owned registries are never reset as a side effect of this host.
  if (env.mode === "runtime") {
    for (const mod of loadedModules) deregisterModuleTools(mod.name);
  }
  clearModuleEventSubscriptions(state);
  state.modules.splice(0);

  for (const mod of loadedModules.reverse()) {
    const activation = activations.get(mod.name);
    const dispose = activation?.dispose;
    if (dispose) {
      try {
        await dispose();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const message = `[kota] Module "${mod.name}" unload error: ${msg}`;
        if (renderingProvider) {
          renderingProvider.printDiagnostic(
            createTerminalDiagnostic(message, "error"),
          );
        } else {
          printTerminalDiagnostic(message, "error");
        }
      }
    }
    discardModuleLoadState(mod.name, state, env.providerRegistry, env.mode);
  }

  state.moduleSources.clear();
  state.loadFailures.length = 0;
  env.resetBus();
}
