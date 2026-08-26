import { registerModuleConfigSlices } from "./module-config-slices.js";
import type { KotaModule } from "./module-types.js";
import {
  importModuleEntry,
  listModuleDirectories,
  reimportModuleEntry,
} from "./runtime-module-discovery.js";

/**
 * Bundled module discovery.
 *
 * KOTA-bundled modules live in sibling directories under `src/modules/`
 * in source mode and `dist/modules/` in built mode. Discovery is
 * runtime-based, so adding or removing a module directory changes the
 * loaded set without editing a central registry.
 */
export async function discoverBundledModules(): Promise<KotaModule[]> {
  const baseUrl = new URL("../../modules/", import.meta.url);
  const modules: KotaModule[] = [];

  for (const name of listModuleDirectories(baseUrl)) {
    const moduleUrl = new URL(`${name}/`, baseUrl);
    const module = await importModuleEntry<KotaModule>(moduleUrl, "index");
    if (!module) continue;
    modules.push(module);
    registerModuleConfigSlices(module);
  }

  return modules;
}

export function getBundledModulesBaseUrl(): URL {
  return new URL("../../modules/", import.meta.url);
}

export async function reimportBundledModule(name: string): Promise<KotaModule | null> {
  const baseUrl = getBundledModulesBaseUrl();
  const moduleUrl = new URL(`${name}/`, baseUrl);
  return reimportModuleEntry<KotaModule>(moduleUrl, "index");
}
