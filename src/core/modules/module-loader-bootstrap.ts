import type { KotaConfig, LoadConfigOptions } from "#core/config/config.js";
import { reimportBundledModule } from "./bundled-module-discovery.js";
import { loadForeignModules } from "./foreign-module-loader.js";
import { admitDiscoveredModuleDefinitions } from "./module-admission.js";
import { topoSort } from "./module-deps.js";
import { reimportInstalledModule } from "./module-discovery.js";
import type { LoaderState } from "./module-loader-state.js";
import type { KotaModule, ModuleSource } from "./module-types.js";
import type { ProviderRegistry } from "./provider-registry.js";
import { printTerminalDiagnostic } from "./terminal-renderer.js";

export interface LoadAllEnv {
  config: KotaConfig;
  cwd: string;
  verbose: boolean;
  isCommandsMode: boolean;
  providerRegistry: ProviderRegistry;
}

/**
 * Drive the full module load cycle: register sources, topo-sort, load each
 * module (scope + installed + foreign), activate configured providers,
 * then surface aggregated scope-module load failures. The orchestrator
 * passes its own `load(mod)` here so this function never sees the loader's
 * private context plumbing.
 */
export async function loadAllModules(
  state: LoaderState,
  env: LoadAllEnv,
  load: (mod: KotaModule, source: ModuleSource) => Promise<void>,
  getToolCount: () => number,
  bundledModules: KotaModule[],
  installedModules?: KotaModule[],
): Promise<void> {
  const admission = admitDiscoveredModuleDefinitions(
    bundledModules,
    installedModules ?? [],
  );
  for (const failure of admission.failures) {
    state.loadFailures.push({
      ...failure,
      timestamp: new Date().toISOString(),
    });
    if (failure.source === "bundled") {
      printTerminalDiagnostic(
        `[kota] Module "${failure.name}" failed declaration admission: ${failure.message}`,
        "error",
      );
    } else if (env.verbose) {
      printTerminalDiagnostic(
        `[kota] Optional module "${failure.name}" skipped: ${failure.message}`,
        "warn",
      );
    }
  }

  const admittedSources = new Map(
    admission.admitted.map(({ definition, source }) => [definition.name, source]),
  );
  const sorted = topoSort(
    admission.admitted.map(({ definition }) => definition),
  );
  for (const mod of sorted) {
    const source = admittedSources.get(mod.name)!;
    try {
      await load(mod, source);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isBundled = source === "bundled";
      if (isBundled) {
        printTerminalDiagnostic(`[kota] Module "${mod.name}" failed to load: ${msg}`, "error");
      } else if (env.verbose) {
        printTerminalDiagnostic(`[kota] Optional module "${mod.name}" skipped: ${msg}`, "warn");
      }
      state.loadFailures.push({
        name: mod.name,
        source: isBundled ? "bundled" : "installed",
        message: msg,
        timestamp: new Date().toISOString(),
      });
    }
  }

  if (env.config.foreignModules && env.config.foreignModules.length > 0 && !env.isCommandsMode) {
    const foreign = await loadForeignModules(
      env.config.foreignModules,
      env.cwd,
      env.config.modules,
    );
    for (const candidate of foreign) {
      const mod = candidate.definition;
      try {
        await load(mod, "foreign");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        try {
          await candidate.discard();
        } catch (disposeError) {
          const disposeMessage = disposeError instanceof Error
            ? disposeError.message
            : String(disposeError);
          printTerminalDiagnostic(
            `[kota] Foreign module "${mod.name}" cleanup failed: ${disposeMessage}`,
            "error",
          );
        }
        state.loadFailures.push({
          name: mod.name,
          source: "foreign",
          message: msg,
          timestamp: new Date().toISOString(),
        });
        printTerminalDiagnostic(
          `[kota] Foreign module "${mod.name}" failed to register: ${msg}`,
          "error",
        );
      }
    }
  }

  activateConfiguredProviders(env.config, env.verbose, env.providerRegistry);

  const bundledFailures = state.loadFailures.filter(
    (failure) => failure.source === "bundled",
  );
  if (bundledFailures.length > 0) {
    const details = bundledFailures
      .map((failure) => `  ${failure.name}: ${failure.message}`)
      .join("\n");
    throw new Error(
      `${bundledFailures.length} bundled module(s) failed to load:\n${details}`,
    );
  }

  if (state.modules.length > 0 && env.verbose) {
    printTerminalDiagnostic(
      `[kota] Modules: ${state.modules.length} loaded, ${getToolCount()} tool(s)`,
    );
  }
}

export function activateConfiguredProviders(
  config: KotaConfig,
  verbose: boolean,
  reg: ProviderRegistry,
): void {
  const providers = config.providers;
  if (!providers) return;

  for (const [type, name] of Object.entries(providers)) {
    if (!reg.setActiveById(type, name)) {
      const available = reg.introspect(type).names.join(", ") || "(none)";
      printTerminalDiagnostic(
        `[kota] Provider "${name}" for "${type}" not found. Available: ${available}`,
        "warn",
      );
    } else if (verbose) {
      printTerminalDiagnostic(`[kota] Provider for "${type}" set to "${name}"`);
    }
  }
}

export async function reimportModule(
  name: string,
  source: ModuleSource,
  cwd: string,
  configOptions: LoadConfigOptions = {},
): Promise<KotaModule | null> {
  try {
    if (source === "bundled") return await reimportBundledModule(name);
    if (source === "installed") {
      return await reimportInstalledModule(name, cwd, configOptions);
    }
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    printTerminalDiagnostic(`[kota] Failed to reimport module "${name}": ${msg}`, "error");
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
  env: { cwd: string; verbose: boolean; globalConfigPath?: string },
  load: (mod: KotaModule, source: ModuleSource) => Promise<void>,
  unload: (name: string) => Promise<boolean>,
): Promise<boolean> {
  const source = state.moduleSources.get(moduleName);
  const registryMod = state.moduleRegistry.get(moduleName);
  if (!registryMod) return false;

  const freshMod = source
    ? await reimportModule(moduleName, source, env.cwd, {
      globalConfigPath: env.globalConfigPath,
    })
    : null;
  const modToLoad = freshMod ?? registryMod;

  if (state.modules.some((m) => m.name === moduleName)) {
    await unload(moduleName);
  }

  await load(modToLoad, source ?? "bundled");

  if (env.verbose) {
    const how = freshMod ? "from disk" : "from registry";
    printTerminalDiagnostic(`[kota] Module "${moduleName}" reloaded (${how})`);
  }
  return true;
}
