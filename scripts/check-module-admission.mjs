import { discoverBundledModules } from "#core/modules/bundled-module-discovery.js";
import { ModuleLoader } from "#core/modules/module-loader.js";

// Admit the shipped composition without activating providers or channels.
const loader = new ModuleLoader({}, false, { mode: "commands" });
try {
  await loader.loadAll(await discoverBundledModules());
  console.log(`Admitted ${loader.getModuleCount()} bundled modules.`);
} finally {
  await loader.unloadAll();
}
