import type { KotaModule } from "../module-types.js";
import {
  importModuleEntry,
  listModuleDirectories,
} from "../runtime-module-discovery.js";

/**
 * Project module discovery.
 *
 * Project-owned modules live in sibling directories under `src/modules/`
 * in source mode and `dist/modules/` in built mode. Discovery is
 * runtime-based, so adding or removing a module directory changes the
 * loaded set without editing a central registry.
 */
export async function discoverProjectModules(): Promise<KotaModule[]> {
  const baseUrl = new URL("./", import.meta.url);
  const modules: KotaModule[] = [];

  for (const name of listModuleDirectories(baseUrl)) {
    const moduleUrl = new URL(`${name}/`, baseUrl);
    const module = await importModuleEntry<KotaModule>(moduleUrl, "index");
    if (!module) continue;
    modules.push(module);
  }

  return modules;
}
