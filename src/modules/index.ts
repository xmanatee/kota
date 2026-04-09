import type { KotaExtension } from "../extension-types.js";
import {
  importModuleEntry,
  listModuleDirectories,
} from "../runtime-module-discovery.js";

/**
 * Built-in extension discovery.
 *
 * Built-in extensions live in sibling directories under `src/extensions/` in
 * source mode and `dist/extensions/` in built mode. Discovery is runtime-based
 * so adding or removing an extension directory changes the loaded set without
 * editing a central registry.
 */
export async function discoverBuiltinExtensions(): Promise<KotaExtension[]> {
  const baseUrl = new URL("./", import.meta.url);
  const extensions: KotaExtension[] = [];

  for (const name of listModuleDirectories(baseUrl)) {
    const moduleUrl = new URL(`${name}/`, baseUrl);
    const extension = await importModuleEntry<KotaExtension>(moduleUrl, "index");
    if (!extension) continue;
    extensions.push(extension);
  }

  return extensions;
}
