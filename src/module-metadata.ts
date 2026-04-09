import type { KotaConfig } from "./config.js";
import { discoverModules } from "./module-discovery.js";
import { ModuleLoader } from "./module-loader.js";
import { discoverProjectModules } from "./modules/index.js";

export async function loadModuleMetadata(
  config: KotaConfig,
  projectDir = process.cwd(),
  verbose = false,
): Promise<ModuleLoader> {
  const loader = new ModuleLoader(config, verbose, { commandsOnly: true });
  loader.setCwd(projectDir);
  const projectModules = await discoverProjectModules();
  const userModules = await discoverModules(projectDir, verbose);
  await loader.loadAll([...projectModules, ...userModules]);
  return loader;
}
