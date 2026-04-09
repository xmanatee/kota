import type { KotaConfig } from "./config.js";
import { discoverExtensions } from "./extension-discovery.js";
import { ExtensionLoader } from "./extension-loader.js";
import { discoverBuiltinExtensions } from "./extensions/index.js";

export async function loadExtensionMetadata(
  config: KotaConfig,
  projectDir = process.cwd(),
  verbose = false,
): Promise<ExtensionLoader> {
  const loader = new ExtensionLoader(config, verbose, { commandsOnly: true });
  loader.setCwd(projectDir);
  const builtinExtensions = await discoverBuiltinExtensions();
  const userExtensions = await discoverExtensions(projectDir, verbose);
  await loader.loadAll([...builtinExtensions, ...userExtensions]);
  return loader;
}
