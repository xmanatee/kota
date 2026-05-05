import type { KotaConfig } from "#core/config/config.js";
import { loadForeignModules } from "./foreign-module-loader.js";
import { topoSort } from "./module-deps.js";
import { reimportInstalledModule } from "./module-discovery.js";
import type { LoaderState } from "./module-loader-state.js";
import type { KotaModule, ModuleSource } from "./module-types.js";
import { reimportProjectModule } from "./project-discovery.js";
import { getProviderRegistry } from "./provider-registry.js";

export interface LoadAllEnv {
  config: KotaConfig;
  cwd: string;
  verbose: boolean;
  isCommandsMode: boolean;
}

/**
 * Drive the full module load cycle: register sources, topo-sort, load each
 * module (project + installed + foreign), activate configured providers,
 * then surface aggregated project-module load failures. The orchestrator
 * passes its own `load(mod)` here so this function never sees the loader's
 * private context plumbing.
 */
export async function loadAllModules(
  state: LoaderState,
  env: LoadAllEnv,
  load: (mod: KotaModule) => Promise<void>,
  getToolCount: () => number,
  projectModules: KotaModule[],
  installedModules?: KotaModule[],
): Promise<void> {
  const projectNames = new Set(projectModules.map((m) => m.name));
  const allModules = [...projectModules, ...(installedModules ?? [])];

  for (const mod of projectModules) state.moduleSources.set(mod.name, "project");
  for (const mod of installedModules ?? []) state.moduleSources.set(mod.name, "installed");

  const sorted = topoSort(allModules);
  for (const mod of sorted) {
    try {
      await load(mod);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isProject = projectNames.has(mod.name);
      if (isProject) {
        console.error(`[kota] Module "${mod.name}" failed to load: ${msg}`);
      } else if (env.verbose) {
        console.error(`[kota] Optional module "${mod.name}" skipped: ${msg}`);
      }
      state.loadFailures.set(mod.name, { message: msg, timestamp: new Date().toISOString() });
    }
  }

  if (env.config.foreignModules && env.config.foreignModules.length > 0 && !env.isCommandsMode) {
    const foreign = await loadForeignModules(
      env.config.foreignModules,
      env.cwd,
      env.config.modules,
    );
    for (const mod of foreign) {
      state.moduleSources.set(mod.name, "foreign");
      try {
        await load(mod);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[kota] Foreign module "${mod.name}" failed to register: ${msg}`);
      }
    }
  }

  activateConfiguredProviders(env.config, env.verbose);

  const projectFailures = [...state.loadFailures.entries()]
    .filter(([name]) => projectNames.has(name));
  if (projectFailures.length > 0) {
    const details = projectFailures.map(([name, f]) => `  ${name}: ${f.message}`).join("\n");
    throw new Error(
      `${projectFailures.length} project module(s) failed to load:\n${details}`,
    );
  }

  if (state.modules.length > 0 && env.verbose) {
    console.error(`[kota] Modules: ${state.modules.length} loaded, ${getToolCount()} tool(s)`);
  }
}

export function activateConfiguredProviders(config: KotaConfig, verbose: boolean): void {
  const providers = config.providers;
  if (!providers) return;
  const reg = getProviderRegistry();
  if (!reg) return;

  for (const [type, name] of Object.entries(providers)) {
    if (!reg.setActiveById(type, name)) {
      const available = reg.introspect(type).names.join(", ") || "(none)";
      console.error(
        `[kota] Provider "${name}" for "${type}" not found. Available: ${available}`,
      );
    } else if (verbose) {
      console.error(`[kota] Provider for "${type}" set to "${name}"`);
    }
  }
}

export async function reimportModule(
  name: string,
  source: ModuleSource,
  cwd: string,
): Promise<KotaModule | null> {
  try {
    if (source === "project") return await reimportProjectModule(name);
    if (source === "installed") return await reimportInstalledModule(name, cwd);
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[kota] Failed to reimport module "${name}": ${msg}`);
    return null;
  }
}

/**
 * Reload a module by re-importing its source if available, then unloading and
 * reloading it through the orchestrator's own load/unload entry points. The
 * orchestrator hands those entry points in as callbacks so this function never
 * sees the loader's per-module state plumbing.
 */
export async function reloadModule(
  moduleName: string,
  state: LoaderState,
  env: { cwd: string; verbose: boolean },
  load: (mod: KotaModule) => Promise<void>,
  unload: (name: string) => Promise<boolean>,
): Promise<boolean> {
  const source = state.moduleSources.get(moduleName);
  const registryMod = state.moduleRegistry.get(moduleName);
  if (!registryMod) return false;

  const freshMod = source ? await reimportModule(moduleName, source, env.cwd) : null;
  const modToLoad = freshMod ?? registryMod;

  if (state.modules.some((m) => m.name === moduleName)) {
    await unload(moduleName);
  }

  await load(modToLoad);
  if (source) state.moduleSources.set(moduleName, source);

  if (env.verbose) {
    const how = freshMod ? "from disk" : "from registry";
    console.error(`[kota] Module "${moduleName}" reloaded (${how})`);
  }
  return true;
}
