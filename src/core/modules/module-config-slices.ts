/**
 * Helpers that wire admitted module `configSlices` into the global config
 * registry before `loadConfig()` and return exact lifecycle disposers.
 *
 * Registration is idempotent for the same slice instance; a second slice
 * with a key already claimed by a different module is rejected by
 * `registerConfigSlice` itself.
 */

import { registerConfigSlice } from "#core/config/config-slice.js";
import type { KotaModule } from "./module-types.js";

export function registerModuleConfigSlices(mod: KotaModule): () => void {
  if (!mod.configSlices) return () => {};
  const disposers: (() => void)[] = [];
  try {
    for (const slice of mod.configSlices) {
      disposers.push(registerConfigSlice(slice, mod.name));
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose();
    throw error;
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    for (const dispose of disposers.reverse()) dispose();
  };
}

/**
 * Make only identity-admitted declarations visible to config loading.
 * Optional installed modules that collide on a config key remain isolated for
 * the loader to report; bundled collisions abort the host before config use.
 */
export function registerAdmittedModuleConfigSlices(
  modules: readonly {
    definition: KotaModule;
    source: "bundled" | "installed";
  }[],
): () => void {
  const disposers: (() => void)[] = [];
  try {
    for (const { definition, source } of modules) {
      try {
        disposers.push(registerModuleConfigSlices(definition));
      } catch (error) {
        if (source === "bundled") throw error;
      }
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose();
    throw error;
  }
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    for (const dispose of disposers.reverse()) dispose();
  };
}
