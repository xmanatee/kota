import type { UiSurfaceSource } from "#core/modules/module-ui-surfaces.js";
import { buildSetupUiSurface } from "./ui-surface.js";

export const setupUiSurfaceSource: UiSurfaceSource = {
  sourceId: "setup",
  project: async (context) => {
    const setup = await context.read("setup", () => context.client.setup.list());
    return [buildSetupUiSurface({ scopeId: context.scopeId, setup })];
  },
};
