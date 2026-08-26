import type { KotaConfig } from "#core/config/config.js";
import { discoverBundledModules } from "./bundled-module-discovery.js";
import { discoverModules } from "./module-discovery.js";
import { ModuleLoader } from "./module-loader.js";

export async function loadModuleMetadata(
  config: KotaConfig,
  scopeRoot = process.cwd(),
  verbose = false,
): Promise<ModuleLoader> {
  const loader = new ModuleLoader(config, verbose, { mode: "commands" });
  loader.setCwd(scopeRoot);
  const bundledModules = await discoverBundledModules();
  const userModules = await discoverModules(scopeRoot, verbose);
  await loader.loadAll(bundledModules, userModules);
  return loader;
}
