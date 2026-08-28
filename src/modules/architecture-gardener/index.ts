import type { KotaModule } from "#core/modules/module-types.js";
import { buildArchitectureGardenerCommand } from "./cli-command.js";
import { architectureChanged, architectureReviewRequested } from "./events.js";
import {
  buildGardenerControlRoutes,
  buildGardenerPublicRoutes,
} from "./routes.js";
import { architectureGardenerUiSurfaceSource } from "./ui-source.js";
import architectureGardenerWorkflow from "./workflow.js";

const architectureGardenerModule: KotaModule = {
  name: "architecture-gardener",
  version: "1.0.0",
  description:
    "Continuous architectural simplification, AST fitness functions, and generated work",
  dependencies: [
    "autonomy",
    "repo-tasks",
    "rendering",
  ],
  events: [
    architectureReviewRequested,
    architectureChanged,
  ],
  workflows: [architectureGardenerWorkflow],
  commands: (ctx) => [buildArchitectureGardenerCommand(ctx)],
  routes: (ctx) => buildGardenerPublicRoutes(ctx),
  controlRoutes: (ctx) => buildGardenerControlRoutes(ctx),
  uiSurfaces: [architectureGardenerUiSurfaceSource],
};

export default architectureGardenerModule;
