import type { KotaModule } from "#core/modules/module-types.js";
import { buildArchitectureGardenerCommand } from "./cli-command.js";
import { architectureReviewRequested } from "./events.js";
import {
  buildGardenerControlRoutes,
} from "./routes.js";
import { buildArchitectureGardenerUiSurfaceSource } from "./ui-source.js";
import architectureGardenerWorkflow, { agent } from "./workflow.js";

const architectureGardenerModule: KotaModule = {
  name: "architecture-gardener",
  version: "1.0.0",
  description:
    "Evidence-led architecture investigation and generated simplification work",
  dependencies: [
    "autonomy",
    "repo-tasks",
    "rendering",
  ],
  events: [
    architectureReviewRequested,
  ],
  agents: [agent],
  workflows: [architectureGardenerWorkflow],
  commands: (ctx) => [buildArchitectureGardenerCommand(ctx)],
  controlRoutes: (ctx) => buildGardenerControlRoutes(ctx),
  uiSurfaces: (ctx) => [buildArchitectureGardenerUiSurfaceSource(ctx)],
};

export default architectureGardenerModule;
