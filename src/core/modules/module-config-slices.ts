/**
 * Helper that wires a module's declarative `configSlices` into the global
 * config-slice registry. Used both during dynamic discovery (so
 * `loadConfig()` sees slices before `ModuleLoader.load()` runs) and at
 * load time (so direct `loader.load(mod)` calls also register).
 *
 * Registration is idempotent for the same slice instance; a second slice
 * with a key already claimed by a different module is rejected by
 * `registerConfigSlice` itself.
 */

import { registerConfigSlice } from "#core/config/config-slice.js";
import type { KotaModule } from "./module-types.js";

export function registerModuleConfigSlices(mod: KotaModule): void {
  if (!mod.configSlices) return;
  for (const slice of mod.configSlices) {
    registerConfigSlice(slice, mod.name);
  }
}
