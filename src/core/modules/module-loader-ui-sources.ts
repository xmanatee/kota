import type { LoaderState } from "./module-loader-state.js";
import type { RegisteredUiSurfaceSource } from "./module-ui-surfaces.js";

export function collectRegisteredUiSurfaceSources(
  state: LoaderState,
): RegisteredUiSurfaceSource[] {
  return state.modules.flatMap((mod) =>
    (state.moduleUiSurfaceSources.get(mod.name) ?? []).map((source) => ({
      moduleName: mod.name,
      source,
    }))
  );
}
