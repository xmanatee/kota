import { loadConfig } from "#core/config/config.js";
import type { KotaModule } from "./module-types.js";
import { discoverModules } from "./module-discovery.js";
import { ModuleLoader } from "./module-loader.js";
import { discoverProjectModules } from "./project-discovery.js";
import {
  getProviderRegistry,
  initProviderRegistry,
  registerDefaultProviders,
} from "./provider-registry.js";

const loadPromises = new Map<string, Promise<void>>();

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
  if (configuredEntries.length === 0) return;

  const existing = getProviderRegistry();
  if (
    existing &&
    configuredEntries.every(([type, name]) => existing.getActiveName(type) === name)
  ) {
    return;
  }

  const key = configuredEntries
    .map(([type, name]) => `${type}:${name}`)
    .sort()
    .join("|");
  let loadPromise = loadPromises.get(key);
  if (!loadPromise) {
    loadPromise = (async () => {
      if (!getProviderRegistry()) initProviderRegistry();
      registerDefaultProviders(cwd);
      const projectModules = await discoverProjectModules();
      const modules = await discoverModules(cwd, false);
      const selected = selectProviderModules(
        [...projectModules, ...modules],
        configuredEntries.map(([, name]) => name),
      );
      const loader = new ModuleLoader(
        {
          ...config,
          providers: Object.fromEntries(configuredEntries),
        },
        false,
      );
      loader.setCwd(cwd);
      await loader.loadAll(selected);
    })();
    loadPromises.set(key, loadPromise);
  }
  await loadPromise;
}
