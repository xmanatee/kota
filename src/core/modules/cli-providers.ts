import { loadConfig } from "#core/config/config.js";
import { discoverModules } from "./module-discovery.js";
import { ModuleLoader } from "./module-loader.js";
import type { KotaModule } from "./module-types.js";
import { discoverProjectModules } from "./project-discovery.js";
import {
  getProviderRegistry,
  initProviderRegistry,
  registerDefaultProviders,
} from "./provider-registry.js";

function selectProviderModules(
  modules: readonly KotaModule[],
  providerNames: readonly string[],
): KotaModule[] {
  const byName = new Map(modules.map((mod) => [mod.name, mod]));
  const selected = new Map<string, KotaModule>();

  const visit = (name: string): void => {
    if (selected.has(name)) return;
    const mod = byName.get(name);
    if (!mod) return;
    for (const dependency of mod.dependencies ?? []) visit(dependency);
    selected.set(mod.name, mod);
  };

  for (const name of providerNames) visit(name);
  return [...selected.values()];
}

export async function ensureCliProvidersFor(
  types: readonly string[],
  cwd = process.cwd(),
): Promise<void> {
  const config = loadConfig(cwd);

  const configuredEntries = types
    .map((type) => [type, config.providers?.[type]] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]));

  // Ensure the registry has in-core defaults populated (memory, task, history).
  if (!getProviderRegistry()) initProviderRegistry();
  registerDefaultProviders();

  const registry = getProviderRegistry();
  const unconfiguredNeedingLoad = types.filter((type) => {
    if (config.providers?.[type]) return false;
    return !registry?.get(type);
  });

  if (configuredEntries.length === 0 && unconfiguredNeedingLoad.length === 0) {
    return;
  }

  // Module names: configured overrides, plus service-type-named modules for
  // unconfigured types that have no active default (e.g. knowledge).
  const moduleNames = [
    ...configuredEntries.map(([, name]) => name),
    ...unconfiguredNeedingLoad,
  ];

  const providersForLoader = Object.fromEntries(configuredEntries);
  const projectModules = await discoverProjectModules();
  const modules = await discoverModules(cwd, false);
  const selected = selectProviderModules(
    [...projectModules, ...modules],
    moduleNames,
  );
  const loader = new ModuleLoader(
    {
      ...config,
      providers: providersForLoader,
    },
    false,
  );
  loader.setCwd(cwd);
  await loader.loadAll(selected);
}
