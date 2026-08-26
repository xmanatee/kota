import type { UiSurfaceSource } from "#core/modules/module-ui-surfaces.js";
import { buildModulesAgentsUiSurface } from "./ui-surface.js";

export const modulesAgentsUiSurfaceSource: UiSurfaceSource = {
  sourceId: "modules-agents",
  scope: async (context) => {
    const [modules, agents] = await Promise.all([
      context.read("modules", () => context.client.modules.list()),
      context.read("agents", () => context.client.agents.list()),
    ]);
    return [buildModulesAgentsUiSurface({
      scopeId: context.scopeId,
      modules,
      agents,
    })];
  },
};
